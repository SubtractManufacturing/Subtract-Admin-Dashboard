import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "./db";
import { actionItems, type UserRole } from "./db/schema";
import { sendRfqImportJob } from "./queue/producer.server";
import { retryRfqImportNow } from "./rfq-intake/postgres.server";

export type ActionItemActor = {
  userId: string;
  role: UserRole;
};

function isElevated(role: UserRole) {
  return role === "Admin" || role === "Dev";
}

export async function getActionItemsForUser(userId: string) {
  const items = await db
    .select()
    .from(actionItems)
    .where(
      and(
        eq(actionItems.status, "active"),
        isNull(actionItems.deletedAt),
      ),
    )
    .orderBy(desc(actionItems.createdAt));
  return items.map((item) => ({
    ...item,
    isUnread: !item.seenBy.includes(userId),
  }));
}

export async function getActionItemCounts(userId: string) {
  const [row] = await db
    .select({
      totalActive: count(),
      unreadActive: sql<number>`count(*) filter (where not (${userId} = any(${actionItems.seenBy})))::int`,
    })
    .from(actionItems)
    .where(
      and(
        eq(actionItems.status, "active"),
        isNull(actionItems.deletedAt),
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
    .where(and(eq(actionItems.id, id), isNull(actionItems.deletedAt)))
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
    .where(and(eq(actionItems.id, id), isNull(actionItems.deletedAt)))
    .limit(1);
  if (!item) throw new Error("Action Item not found");
  if (item.type === "rfq_import_failure") {
    throw new Error("RFQ import failures resolve automatically after a successful import");
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
    .where(eq(actionItems.id, id))
    .returning();
  return updated;
}

export async function retryActionItemNow(id: string, actor: ActionItemActor) {
  if (!isElevated(actor.role)) throw new Error("Admin or Dev role required");
  const [item] = await db
    .select()
    .from(actionItems)
    .where(
      and(
        eq(actionItems.id, id),
        eq(actionItems.type, "rfq_import_failure"),
        isNull(actionItems.deletedAt),
      ),
    )
    .limit(1);
  if (!item?.entityId) throw new Error("RFQ import Action Item not found");
  const receiptKey = await retryRfqImportNow(item.entityId);
  if (!receiptKey) throw new Error("RFQ import ledger entry not found");
  await sendRfqImportJob({ receiptKey }, { force: true });
}

export async function softDeleteActionItem(id: string, actor: ActionItemActor) {
  if (!isElevated(actor.role)) throw new Error("Admin or Dev role required");
  const now = new Date();
  const [updated] = await db
    .update(actionItems)
    .set({ deletedAt: now, deletedBy: actor.userId, updatedAt: now })
    .where(and(eq(actionItems.id, id), isNull(actionItems.deletedAt)))
    .returning();
  return updated ?? null;
}
