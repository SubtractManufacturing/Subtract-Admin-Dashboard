import { and, count, desc, eq, sql } from "drizzle-orm";

import { resolveSatisfiedCustomerMatchReviews } from "./customer-match-review.server";
import { db } from "./db";
import { actionItems, type UserRole } from "./db/schema";
import { retryRfqImport } from "./rfq-intake/retry.server";

export class ActionItemCommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ActionItemCommandError";
  }
}

export type ActionItemActor = {
  userId: string;
  role: UserRole;
};

function isElevated(role: UserRole) {
  return role === "Admin" || role === "Dev";
}

function requireElevated(role: UserRole) {
  if (!isElevated(role)) {
    throw new ActionItemCommandError("Admin or Dev role required", 403);
  }
}

export async function getActionItemsForUser(userId: string) {
  await resolveSatisfiedCustomerMatchReviews();
  const items = await db
    .select()
    .from(actionItems)
    .where(
      and(
        eq(actionItems.status, "active"),
        eq(actionItems.isArchived, false),
      ),
    )
    .orderBy(desc(actionItems.createdAt));
  return items.map((item) => ({
    ...item,
    isUnread: !item.seenBy.includes(userId),
  }));
}

export async function getActionItemCounts(userId: string) {
  await resolveSatisfiedCustomerMatchReviews();
  const [row] = await db
    .select({
      totalActive: count(),
      unreadActive: sql<number>`count(*) filter (where not (${userId} = any(${actionItems.seenBy})))::int`,
    })
    .from(actionItems)
    .where(
      and(
        eq(actionItems.status, "active"),
        eq(actionItems.isArchived, false),
      ),
    );
  return {
    totalActive: Number(row?.totalActive ?? 0),
    unreadActive: Number(row?.unreadActive ?? 0),
  };
}

export async function markActionItemRead(id: string, actor: ActionItemActor) {
  const [updated] = await db
    .update(actionItems)
    .set({
      seenBy: sql`case when not (${actor.userId} = any(${actionItems.seenBy})) then array_append(${actionItems.seenBy}, ${actor.userId}) else ${actionItems.seenBy} end`,
      updatedAt: new Date(),
    })
    .where(and(eq(actionItems.id, id), eq(actionItems.isArchived, false)))
    .returning();
  return updated ?? null;
}

export async function resolveActionItem(
  id: string,
  actor: ActionItemActor,
  resolution = "Reviewed",
) {
  const [item] = await db
    .select()
    .from(actionItems)
    .where(and(eq(actionItems.id, id), eq(actionItems.isArchived, false)))
    .limit(1);
  if (!item) throw new ActionItemCommandError("Action Item not found", 404);
  if (item.type === "rfq_import_failure") {
    throw new ActionItemCommandError(
      "RFQ import failures resolve automatically after a successful import",
      409,
    );
  }
  if (item.type === "customer_match_review") {
    throw new ActionItemCommandError(
      "Customer match reviews resolve once the Customers are merged or confirmed not duplicates",
      409,
    );
  }
  const now = new Date();
  const [updated] = await db
    .update(actionItems)
    .set({
      status: "resolved",
      resolvedAt: now,
      resolvedBy: actor.userId,
      resolution,
      updatedAt: now,
    })
    .where(and(eq(actionItems.id, id), eq(actionItems.status, "active")))
    .returning();
  if (!updated) {
    throw new ActionItemCommandError("Action Item is no longer active", 409);
  }
  return updated;
}

export async function retryActionItemNow(id: string, actor: ActionItemActor) {
  requireElevated(actor.role);
  const [item] = await db
    .select()
    .from(actionItems)
    .where(
      and(
        eq(actionItems.id, id),
        eq(actionItems.type, "rfq_import_failure"),
        eq(actionItems.status, "active"),
        eq(actionItems.isArchived, false),
      ),
    )
    .limit(1);
  if (!item?.entityId) {
    throw new ActionItemCommandError("RFQ import Action Item not found", 404);
  }
  if (!(await retryRfqImport(item.entityId))) {
    throw new ActionItemCommandError("RFQ import ledger entry not found", 404);
  }
}

export async function softDeleteActionItem(id: string, actor: ActionItemActor) {
  requireElevated(actor.role);
  const [existing] = await db
    .select({ type: actionItems.type, status: actionItems.status })
    .from(actionItems)
    .where(and(eq(actionItems.id, id), eq(actionItems.isArchived, false)))
    .limit(1);
  if (existing?.type === "customer_match_review" && existing.status === "active") {
    throw new ActionItemCommandError(
      "Customer match reviews cannot be deleted; merge the Customers or confirm they are not duplicates",
      409,
    );
  }
  const now = new Date();
  const [updated] = await db
    .update(actionItems)
    .set({
      isArchived: true,
      deletedAt: now,
      deletedBy: actor.userId,
      updatedAt: now,
    })
    .where(and(eq(actionItems.id, id), eq(actionItems.isArchived, false)))
    .returning();
  return updated ?? null;
}
