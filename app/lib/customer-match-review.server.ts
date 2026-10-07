import { and, eq } from "drizzle-orm";

import { candidateIdsFromMetadata, customerPairKey } from "./customer-merge-view";
import { db } from "./db";
import {
  actionItems,
  customerMergeDismissals,
  customers,
} from "./db/schema";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbExecutor = typeof db | DbTransaction;

/**
 * Follow merge pointers (A -> B -> C) to the final active Customer. Returns
 * null when the Customer does not exist or was archived without being merged.
 */
export async function resolveFinalCustomerId(
  customerId: number,
  executor: DbExecutor = db,
): Promise<number | null> {
  const seen = new Set<number>();
  let currentId: number | null = customerId;
  while (currentId !== null && !seen.has(currentId)) {
    seen.add(currentId);
    const [row] = await executor
      .select({
        id: customers.id,
        isArchived: customers.isArchived,
        mergedIntoCustomerId: customers.mergedIntoCustomerId,
      })
      .from(customers)
      .where(eq(customers.id, currentId))
      .limit(1);
    if (!row) return null;
    if (!row.isArchived) return row.id;
    currentId = row.mergedIntoCustomerId;
  }
  return null;
}

/**
 * Resolve open "Customer match review" items whose candidates are no longer in
 * question: they were merged into one Customer, no candidate is active any
 * more, or every remaining pair was dismissed as "not duplicates". Safe to
 * call repeatedly.
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

  const dismissed = new Set(
    (await executor.select().from(customerMergeDismissals)).map((row) =>
      customerPairKey(row.lowCustomerId, row.highCustomerId),
    ),
  );
  const now = options.now ?? new Date();
  let resolvedCount = 0;

  for (const item of open) {
    const candidates = candidateIdsFromMetadata(item.metadata);
    if (candidates.length === 0) continue;

    const remaining = new Set<number>();
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
    } else if (
      ids.every((a, i) =>
        ids.slice(i + 1).every((b) => dismissed.has(customerPairKey(a, b))),
      )
    ) {
      resolution = "Confirmed not duplicates";
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
