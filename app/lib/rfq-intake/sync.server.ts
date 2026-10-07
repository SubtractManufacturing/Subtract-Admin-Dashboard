import { randomUUID } from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";

import { db } from "../db";
import { developerSettings } from "../db/schema";
import { RFQ_INTAKE_SETTINGS } from "../developerSettings";
import { scanRfqReceipts } from "./scan.server";
import { isRfqIntakeEnabled } from "./storage.server";
import {
  runRfqIntakeSync,
  type RfqSyncCooldownStore,
  type RfqSyncScanResult,
} from "./sync";

type StoredSyncState = RfqSyncScanResult & { claimId: string };
type RunningSyncState = { claimId: string; status: "running" };
const HEARTBEAT_INTERVAL_MS = 5_000;
const STALE_HEARTBEAT_MS = 15_000;

function parseState(value: string | null): StoredSyncState | RunningSyncState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.claimId !== "string" ||
      !["running", "completed", "failed"].includes(String(parsed.status))
    ) {
      return null;
    }
    if (parsed.status === "completed" && typeof parsed.newImports === "number") {
      return {
        claimId: parsed.claimId,
        status: "completed",
        newImports: parsed.newImports,
      };
    }
    if (parsed.status === "running" || parsed.status === "failed") {
      return {
        claimId: parsed.claimId,
        status: parsed.status,
      } as RunningSyncState | StoredSyncState;
    }
  } catch {
    return null;
  }
  return null;
}

function asResult(
  state: StoredSyncState | RunningSyncState | null,
): RfqSyncScanResult | null {
  if (!state || state.status === "running") return null;
  if (state.status === "completed") {
    return { status: "completed", newImports: state.newImports };
  }
  return { status: "failed" };
}

function runningClaimWhere(claimId: string) {
  return and(
    eq(developerSettings.key, RFQ_INTAKE_SETTINGS.SYNC_STATE),
    sql`${developerSettings.value}::jsonb ->> 'claimId' = ${claimId}`,
    sql`${developerSettings.value}::jsonb ->> 'status' = 'running'`,
  );
}

const postgresCooldownStore: RfqSyncCooldownStore = {
  async claim(now, cooldownMs) {
    const claimId = randomUUID();
    const runningValue = JSON.stringify({ claimId, status: "running" });
    const cutoff = new Date(now.getTime() - cooldownMs);
    const [claimed] = await db
      .insert(developerSettings)
      .values({
        key: RFQ_INTAKE_SETTINGS.SYNC_STATE,
        value: runningValue,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: developerSettings.key,
        set: { value: runningValue, updatedAt: now },
        setWhere: lte(developerSettings.updatedAt, cutoff),
      })
      .returning({ value: developerSettings.value });

    if (claimed) return { acquired: true, claimId };

    const [current] = await db
      .select({ value: developerSettings.value })
      .from(developerSettings)
      .where(eq(developerSettings.key, RFQ_INTAKE_SETTINGS.SYNC_STATE))
      .limit(1);
    const state = parseState(current?.value ?? null);
    return {
      acquired: false,
      claimId: state?.claimId ?? "unknown",
      result: asResult(state),
    };
  },

  maintainClaim(claimId) {
    const interval = setInterval(() => {
      void db
        .update(developerSettings)
        .set({ updatedAt: new Date() })
        .where(runningClaimWhere(claimId))
        .catch((error) => {
          console.error("[RFQ Intake] sync heartbeat failed", error);
        });
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  },

  async complete(claimId, result) {
    await db
      .update(developerSettings)
      .set({
        value: JSON.stringify({ claimId, ...result }),
        updatedAt: new Date(),
      })
      .where(runningClaimWhere(claimId));
  },

  async waitForResult(claimId) {
    let awaitedClaimId = claimId;
    for (;;) {
      const [current] = await db
        .select({
          value: developerSettings.value,
          updatedAt: developerSettings.updatedAt,
        })
        .from(developerSettings)
        .where(eq(developerSettings.key, RFQ_INTAKE_SETTINGS.SYNC_STATE))
        .limit(1);
      const state = parseState(current?.value ?? null);
      if (state?.claimId === awaitedClaimId) {
        const result = asResult(state);
        if (result) return result;
        if (
          current?.updatedAt &&
          current.updatedAt.getTime() <= Date.now() - STALE_HEARTBEAT_MS
        ) {
          return { status: "failed" };
        }
      } else if (state) {
        const result = asResult(state);
        if (result) return result;
        awaitedClaimId = state.claimId;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  },
};

export async function syncRfqIntake() {
  return runRfqIntakeSync({
    enabled: isRfqIntakeEnabled(),
    cooldownStore: postgresCooldownStore,
    now: () => new Date(),
    scan: scanRfqReceipts,
  });
}
