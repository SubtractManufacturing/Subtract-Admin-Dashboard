/** Requires DATABASE_URL with migrations applied. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getActionItemCounts,
  getActionItemsForUser,
  markActionItemRead,
  resolveActionItem,
  softDeleteActionItem,
} from "./action-items.server";
import { db } from "./db";
import { actionItems, users } from "./db/schema";
import { getEnv } from "./env.server";
import { inArray } from "drizzle-orm";

describe("Action Items command and query seam", () => {
  const userA = randomUUID();
  const userB = randomUUID();
  const itemIds: string[] = [];

  beforeAll(async () => {
    if (!getEnv("DATABASE_URL")) {
      throw new Error("DATABASE_URL or DATABASE_URL_FILE is required");
    }
    await db.insert(users).values([
      { id: userA, email: `${userA}@example.invalid`, role: "User" },
      { id: userB, email: `${userB}@example.invalid`, role: "Admin" },
    ]);
  });

  afterAll(async () => {
    if (itemIds.length) await db.delete(actionItems).where(inArray(actionItems.id, itemIds));
    await db.delete(users).where(inArray(users.id, [userA, userB]));
  });

  it("isolates explicit read state per user and removes resolved items from active counts", async () => {
    const [item] = await db
      .insert(actionItems)
      .values({
        type: "customer_match_review",
        title: "Review Customer",
        description: "Ambiguous email",
        entityType: "quote",
        entityId: "123",
      })
      .returning();
    itemIds.push(item.id);

    expect((await getActionItemCounts(userA)).unreadActive).toBeGreaterThanOrEqual(1);
    expect((await getActionItemCounts(userB)).unreadActive).toBeGreaterThanOrEqual(1);
    await markActionItemRead(item.id, { userId: userA, role: "User" });
    expect((await getActionItemsForUser(userA)).find((row) => row.id === item.id)?.isUnread).toBe(false);
    expect((await getActionItemsForUser(userB)).find((row) => row.id === item.id)?.isUnread).toBe(true);

    await resolveActionItem(item.id, { userId: userA, role: "User" }, "Customer checked");
    expect((await getActionItemsForUser(userA)).some((row) => row.id === item.id)).toBe(false);
  });

  it("prevents manual failure resolution and restricts team-wide soft deletion", async () => {
    const [item] = await db
      .insert(actionItems)
      .values({
        type: "rfq_import_failure",
        title: "RFQ failed",
        description: "Storage unavailable",
        entityType: "rfq_import",
        entityId: `TEST-${randomUUID()}`,
      })
      .returning();
    itemIds.push(item.id);

    await expect(
      resolveActionItem(item.id, { userId: userA, role: "User" }),
    ).rejects.toThrow(/resolve automatically/i);
    await expect(
      softDeleteActionItem(item.id, { userId: userA, role: "User" }),
    ).rejects.toThrow(/Admin or Dev/i);
    await softDeleteActionItem(item.id, { userId: userB, role: "Admin" });
    expect((await getActionItemsForUser(userB)).some((row) => row.id === item.id)).toBe(false);
  });
});
