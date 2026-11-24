/**
 * The stage row and the startup step that records Shadow (ADR-0014).
 * Changes the one stage row, so it runs through vitest.serial.config.ts.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../db";
import { cutoverState, eventLogs } from "../db/schema";
import { getEnv } from "../env.server";
import { createCutoverFixture } from "~/test/cutover-fixtures";
import {
  CUTOVER_EVENT_ENTITY,
  getCutoverStage,
  getLastStageChange,
  recordShadowStage,
  setCutoverStage,
  STAGE_CHANGED_EVENT,
} from "./stage.server";

const run = promisify(execFile);
const fixture = createCutoverFixture("stage");
const repoRoot = path.resolve(__dirname, "../../..");

async function stageEvents() {
  return db
    .select()
    .from(eventLogs)
    .where(
      and(
        eq(eventLogs.entityType, CUTOVER_EVENT_ENTITY.entityType),
        eq(eventLogs.entityId, CUTOVER_EVENT_ENTITY.entityId),
        eq(eventLogs.eventType, STAGE_CHANGED_EVENT),
      ),
    );
}

/** Runs the real startup step as its own process, as `prestart` does. */
function startupStep(overrides: Record<string, string>) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  // A `*_FILE` variable wins over the plain one; an override must be the one used.
  if (overrides.DATABASE_URL) delete env.DATABASE_URL_FILE;
  return run(process.execPath, ["--import", "tsx", "scripts/cutover-startup.ts"], {
    cwd: repoRoot,
    env,
  });
}

beforeAll(async () => {
  if (!getEnv("DATABASE_URL")) {
    throw new Error("DATABASE_URL is not set; point it at a disposable database.");
  }
  await fixture.seedUser();
});

afterAll(async () => {
  await recordShadowStage();
  await fixture.cleanup();
});

describe("the stage row", () => {
  it("is recorded as Shadow by a release start when nothing is recorded, with an Event log", async () => {
    await db.delete(cutoverState);
    expect(await getCutoverStage()).toBeNull();
    const before = (await stageEvents()).length;

    expect(await recordShadowStage()).toEqual({ changed: true, from: null, to: "shadow" });
    expect(await getCutoverStage()).toMatchObject({ stage: "shadow", changedBy: null });
    const events = await stageEvents();
    expect(events).toHaveLength(before + 1);
    expect((await getLastStageChange())?.metadata).toEqual({
      from: null,
      to: "shadow",
      source: "release_start",
    });
  });

  it("writes nothing when the stage is already Shadow", async () => {
    await recordShadowStage();
    const before = await getCutoverStage();
    const events = (await stageEvents()).length;

    expect(await recordShadowStage()).toEqual({ changed: false, from: "shadow", to: "shadow" });
    expect(await getCutoverStage()).toEqual(before);
    expect(await stageEvents()).toHaveLength(events);
  });

  it("logs who changed the stage", async () => {
    const change = await setCutoverStage("switch", { actor: fixture.actor, source: "user" });
    expect(change).toEqual({ changed: true, from: "shadow", to: "switch" });
    expect(await getCutoverStage()).toMatchObject({ stage: "switch", changedBy: fixture.userId });
    expect(await getLastStageChange()).toMatchObject({
      userId: fixture.userId,
      userEmail: fixture.actor.email,
      title: "Cutover stage set to Switch",
      metadata: { from: "shadow", to: "switch", source: "user" },
    });
  });

  it("goes back to Shadow from any stage when this release starts", async () => {
    for (const stage of ["switch", "unlocked"] as const) {
      await setCutoverStage(stage, { actor: fixture.actor, source: "user" });
      expect(await recordShadowStage()).toEqual({ changed: true, from: stage, to: "shadow" });
      expect(await getCutoverStage()).toMatchObject({ stage: "shadow", changedBy: null });
      expect((await getLastStageChange())?.metadata).toEqual({
        from: stage,
        to: "shadow",
        source: "release_start",
      });
    }
  });

  it("holds exactly one row", async () => {
    await expect(
      db.insert(cutoverState).values({ id: 2, stage: "shadow" }),
    ).rejects.toThrow();
    expect(await db.select().from(cutoverState)).toHaveLength(1);
  });

  it("stays consistent when two processes start together", async () => {
    await db.delete(cutoverState);
    const before = (await stageEvents()).length;
    const results = await Promise.all([recordShadowStage(), recordShadowStage(), recordShadowStage()]);
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(await db.select().from(cutoverState)).toHaveLength(1);
    expect(await stageEvents()).toHaveLength(before + 1);
  });
});

describe("the startup step", () => {
  it("records Shadow and exits 0", async () => {
    await setCutoverStage("switch", { actor: fixture.actor, source: "user" });
    const { stdout } = await startupStep({});
    expect(stdout).toContain("Stage recorded as Shadow (was switch)");
    expect((await getCutoverStage())?.stage).toBe("shadow");

    const again = await startupStep({});
    expect(again.stdout).toContain("Stage is Shadow.");
  }, 60_000);

  it("exits non-zero when the stage cannot be recorded, so the server does not start", async () => {
    const url = new URL(getEnv("DATABASE_URL")!);
    url.pathname = "/a_database_that_does_not_exist";
    const failure = await startupStep({
      DATABASE_URL: url.toString(),
      CUTOVER_STARTUP_WAIT_MS: "0",
    }).then(
      () => null,
      (error: { code?: number; stderr?: string }) => error,
    );
    expect(failure?.code).toBe(1);
    expect(failure?.stderr).toContain("Refusing to start");
    expect((await getCutoverStage())?.stage).toBe("shadow");
  }, 60_000);
});
