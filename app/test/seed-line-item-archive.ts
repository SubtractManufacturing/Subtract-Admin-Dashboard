/**
 * Integration test seed helpers for line item archive lifecycle tests.
 */

import { db } from "~/lib/db";
import {
  customers,
  orders,
  orderLineItems,
  parts,
  quoteLineItems,
  quoteParts,
  quotes,
} from "~/lib/db/schema";
import { eq } from "drizzle-orm";

export type SeededLineItemArchiveIds = {
  customerId: number;
  quoteId: number;
  quoteLineItemId: number;
  quotePartId: string;
  orderId: number;
  orderLineItemId: number;
  partId: string;
};

export async function seedLineItemArchiveFixture(): Promise<SeededLineItemArchiveIds> {
  const quoteNumber = `TEST-ARCH-${Date.now()}`;

  const [customer] = await db
    .insert(customers)
    .values({ displayName: "Archive Test Co" })
    .returning({ id: customers.id });

  const [quote] = await db
    .insert(quotes)
    .values({
      quoteNumber,
      customerId: customer.id,
      status: "Draft",
      subtotal: "200.00",
      total: "200.00",
    })
    .returning({ id: quotes.id });

  const [quotePart] = await db
    .insert(quoteParts)
    .values({
      quoteId: quote.id,
      partNumber: "QP-ARCH-1",
      partName: "Archive Test Part",
    })
    .returning({ id: quoteParts.id });

  const [quoteLineItem] = await db
    .insert(quoteLineItems)
    .values({
      quoteId: quote.id,
      quotePartId: quotePart.id,
      name: "Archive Test Part",
      quantity: 2,
      unitPrice: "50.00",
      totalPrice: "100.00",
    })
    .returning({ id: quoteLineItems.id });

  const [part] = await db
    .insert(parts)
    .values({
      customerId: customer.id,
      partName: "Order Archive Part",
    })
    .returning({ id: parts.id });

  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: `ORD-ARCH-${Date.now()}`,
      customerId: customer.id,
      totalPrice: "75.00",
      status: "Pending",
    })
    .returning({ id: orders.id });

  const [orderLineItem] = await db
    .insert(orderLineItems)
    .values({
      orderId: order.id,
      partId: part.id,
      name: "Order Archive Part",
      quantity: 3,
      unitPrice: "25.00",
    })
    .returning({ id: orderLineItems.id });

  return {
    customerId: customer.id,
    quoteId: quote.id,
    quoteLineItemId: quoteLineItem.id,
    quotePartId: quotePart.id,
    orderId: order.id,
    orderLineItemId: orderLineItem.id,
    partId: part.id,
  };
}

export async function cleanupLineItemArchiveFixture(
  ids: SeededLineItemArchiveIds,
): Promise<void> {
  await db
    .delete(orderLineItems)
    .where(eq(orderLineItems.orderId, ids.orderId));
  await db.delete(orders).where(eq(orders.id, ids.orderId));
  await db.delete(parts).where(eq(parts.customerId, ids.customerId));
  await db
    .delete(quoteLineItems)
    .where(eq(quoteLineItems.quoteId, ids.quoteId));
  await db.delete(quoteParts).where(eq(quoteParts.quoteId, ids.quoteId));
  await db.delete(quotes).where(eq(quotes.id, ids.quoteId));
  await db.delete(customers).where(eq(customers.id, ids.customerId));
}
