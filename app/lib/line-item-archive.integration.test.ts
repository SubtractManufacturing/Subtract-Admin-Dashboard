/**
 * Integration tests: line item archive lifecycle
 *
 * Requires DATABASE_URL with migrations applied. Run via:
 *   DATABASE_URL=postgres://... npm run test:ci
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  orderLineItems,
  parts,
  quoteLineItems,
  quoteParts,
} from "./db/schema";
import { getQuoteLineItems } from "./line-items";
import { getLineItemsByOrderId } from "./lineItems";
import { calculateQuoteTotals } from "./quotes";
import {
  archiveOrderLineItem,
  archiveQuoteLineItem,
  hardDeleteOrderLineItem,
  hardDeleteQuoteLineItem,
  listArchivedOrderLineItems,
  listArchivedQuoteLineItems,
  purgeExpiredArchivedLineItems,
  restoreOrderLineItem,
  restoreQuoteLineItem,
} from "./line-item-archive.server";
import {
  cleanupLineItemArchiveFixture,
  seedLineItemArchiveFixture,
  type SeededLineItemArchiveIds,
} from "~/test/seed-line-item-archive";

vi.mock("./s3.server", () => ({
  deleteFile: vi.fn(),
  extractS3Key: vi.fn((key: string) => key),
}));

describe("line item archive lifecycle", () => {
  let seeded: SeededLineItemArchiveIds;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set. Set it to a migrated local Postgres instance to run integration tests.",
      );
    }
    seeded = await seedLineItemArchiveFixture();
  });

  afterAll(async () => {
    if (seeded) {
      await cleanupLineItemArchiveFixture(seeded);
    }
  });

  it("archives and restores a quote line item", async () => {
    await archiveQuoteLineItem(seeded.quoteLineItemId, seeded.quoteId);

    const active = await getQuoteLineItems(seeded.quoteId);
    expect(active.some((item) => item.id === seeded.quoteLineItemId)).toBe(
      false,
    );

    const archived = await listArchivedQuoteLineItems(seeded.quoteId);
    expect(archived.some((item) => item.id === seeded.quoteLineItemId)).toBe(
      true,
    );

    const [quotePart] = await db
      .select()
      .from(quoteParts)
      .where(eq(quoteParts.id, seeded.quotePartId))
      .limit(1);
    expect(quotePart?.isArchived).toBe(true);

    const totalsAfterArchive = await calculateQuoteTotals(seeded.quoteId);
    expect(totalsAfterArchive?.subtotal).toBe(0);

    await restoreQuoteLineItem(seeded.quoteLineItemId, seeded.quoteId);

    const activeAfterRestore = await getQuoteLineItems(seeded.quoteId);
    expect(
      activeAfterRestore.some((item) => item.id === seeded.quoteLineItemId),
    ).toBe(true);

    const totalsAfterRestore = await calculateQuoteTotals(seeded.quoteId);
    expect(totalsAfterRestore?.subtotal).toBe(100);
  });

  it("archives and restores an order line item while keeping the part", async () => {
    await archiveOrderLineItem(seeded.orderLineItemId, seeded.orderId);

    const active = await getLineItemsByOrderId(seeded.orderId);
    expect(
      active.some(({ lineItem }) => lineItem.id === seeded.orderLineItemId),
    ).toBe(false);

    const [part] = await db
      .select()
      .from(parts)
      .where(eq(parts.id, seeded.partId))
      .limit(1);
    expect(part?.customerId).toBe(seeded.customerId);

    await restoreOrderLineItem(seeded.orderLineItemId, seeded.orderId);

    const activeAfterRestore = await getLineItemsByOrderId(seeded.orderId);
    expect(
      activeAfterRestore.some(
        ({ lineItem }) => lineItem.id === seeded.orderLineItemId,
      ),
    ).toBe(true);
  });

  it("purges expired archived line items", async () => {
    const past = new Date(Date.now() - 60_000);

    await db
      .update(quoteLineItems)
      .set({
        isArchived: true,
        archivedAt: past,
        hardDeleteAt: past,
      })
      .where(eq(quoteLineItems.id, seeded.quoteLineItemId));

    await db
      .update(quoteParts)
      .set({
        isArchived: true,
        archivedAt: past,
        hardDeleteAt: past,
      })
      .where(eq(quoteParts.id, seeded.quotePartId));

    await db
      .update(orderLineItems)
      .set({
        isArchived: true,
        archivedAt: past,
        hardDeleteAt: past,
      })
      .where(eq(orderLineItems.id, seeded.orderLineItemId));

    const result = await purgeExpiredArchivedLineItems();
    expect(result.purgedQuoteLineItems).toBeGreaterThanOrEqual(1);
    expect(result.purgedOrderLineItems).toBeGreaterThanOrEqual(1);

    const quoteLines = await db
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.id, seeded.quoteLineItemId));
    expect(quoteLines.length).toBe(0);

    const orderLines = await db
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.id, seeded.orderLineItemId));
    expect(orderLines.length).toBe(0);

    const [part] = await db
      .select()
      .from(parts)
      .where(eq(parts.id, seeded.partId))
      .limit(1);
    expect(part?.id).toBe(seeded.partId);

    const archivedOrders = await listArchivedOrderLineItems(seeded.orderId);
    expect(archivedOrders.some((item) => item.id === seeded.orderLineItemId)).toBe(
      false,
    );

    await calculateQuoteTotals(seeded.quoteId);
  });

  it("rejects restoring an active quote line item", async () => {
    const [freshQuotePart] = await db
      .insert(quoteParts)
      .values({
        quoteId: seeded.quoteId,
        partNumber: "QP-ACTIVE",
        partName: "Active Part",
      })
      .returning({ id: quoteParts.id });

    const [freshLineItem] = await db
      .insert(quoteLineItems)
      .values({
        quoteId: seeded.quoteId,
        quotePartId: freshQuotePart.id,
        name: "Active Part",
        quantity: 1,
        unitPrice: "10.00",
        totalPrice: "10.00",
      })
      .returning({ id: quoteLineItems.id });

    await expect(
      restoreQuoteLineItem(freshLineItem.id, seeded.quoteId),
    ).rejects.toThrow("Line item is not archived");

    await hardDeleteQuoteLineItem(freshLineItem.id);
  });

  it("hard deletes order line item without deleting part", async () => {
    const [extraPart] = await db
      .insert(parts)
      .values({
        customerId: seeded.customerId,
        partName: "Hard Delete Part",
      })
      .returning({ id: parts.id });

    const [extraLine] = await db
      .insert(orderLineItems)
      .values({
        orderId: seeded.orderId,
        partId: extraPart.id,
        name: "Hard Delete Part",
        quantity: 1,
        unitPrice: "10.00",
      })
      .returning({ id: orderLineItems.id });

    await hardDeleteOrderLineItem(extraLine.id);

    const [part] = await db
      .select()
      .from(parts)
      .where(eq(parts.id, extraPart.id))
      .limit(1);
    expect(part?.id).toBe(extraPart.id);
  });
});
