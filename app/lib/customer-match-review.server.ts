import { and, eq } from "drizzle-orm";

import { candidateIdsFromMetadata } from "./customer-merge-view";
import { db } from "./db";
import { actionItems } from "./db/schema";
import {
  accountIdForLegacyId,
  resolveFinalAccountId,
} from "./organizations/accounts.server";
import { isUuid } from "./organizations/types";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbExecutor = typeof db | DbTransaction;

/**
 * The active customer account a candidate id ends up as: uuids follow
 * Organization merges; legacy integer ids (resolved items from before
 * ADR-0013) map through the backfill's legacy id first. Null when nothing
 * active remains.
 */
export async function resolveFinalCustomerId(
  customerId: string,
  executor: DbExecutor = db,
): Promise<string | null> {
  const accountId = /^\d+$/.test(customerId)
    ? await accountIdForLegacyId("customer", Number(customerId), executor)
    : customerId;
  if (!accountId || !isUuid(accountId)) return null;
  return resolveFinalAccountId(accountId, executor);
}

/**
 * Resolve open "Customer match review" items whose candidates are no longer in
 * question: they were merged into one Customer, or no candidate is active any
 * more. Items whose Customers are genuinely distinct are resolved by hand.
 * Safe to call repeatedly.
 */
export async function resolveSatisfiedCustomerMatchReviews(
  executor: DbExecutor = db,
  options: { resolvedBy?: string | null; now?: Date } = {},
): Promise<number> {
  const open = await executor
    .select()
    .from(actionItems)
    .where(
      and(
        eq(actionItems.type, "customer_match_review"),
        eq(actionItems.status, "active"),
        eq(actionItems.isArchived, false),
      ),
    );
  if (open.length === 0) return 0;

  const now = options.now ?? new Date();
  let resolvedCount = 0;

  for (const item of open) {
    const candidates = candidateIdsFromMetadata(item.metadata);
    if (candidates.length === 0) continue;

    const remaining = new Set<string>();
    for (const candidateId of candidates) {
      const finalId = await resolveFinalCustomerId(candidateId, executor);
      if (finalId !== null) remaining.add(finalId);
    }
    const ids = [...remaining];
    let resolution: string | null = null;
    if (ids.length === 0) {
      resolution = "Customers no longer active";
    } else if (ids.length === 1) {
      resolution = "Customers merged";
    }
    if (!resolution) continue;

    const [updated] = await executor
      .update(actionItems)
      .set({
        status: "resolved",
        resolvedAt: now,
        resolvedBy: options.resolvedBy ?? null,
        resolution,
        updatedAt: now,
      })
      .where(and(eq(actionItems.id, item.id), eq(actionItems.status, "active")))
      .returning({ id: actionItems.id });
    if (updated) resolvedCount += 1;
  }
  return resolvedCount;
}
