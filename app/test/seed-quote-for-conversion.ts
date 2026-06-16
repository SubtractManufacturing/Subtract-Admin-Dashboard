/**
 * Integration test seed for convertQuoteToOrder.
 *
 * Inserts an Accepted quote with a service line item (no parts) and lead time.
 */

import { db } from "~/lib/db";
import { customers, quoteLineItems, quotes } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

export type SeededConversionQuoteIds = {
  customerId: number;
  quoteId: number;
  quoteLineItemId: number;
  quoteNumber: string;
};

export async function seedQuoteForConversion(): Promise<SeededConversionQuoteIds> {
  const quoteNumber = `TEST-CONV-${Date.now()}`;

  const [customer] = await db
    .insert(customers)
    .values({ displayName: "Conversion Test Co" })
    .returning({ id: customers.id });

  const [quote] = await db
    .insert(quotes)
    .values({
      quoteNumber,
      customerId: customer.id,
      status: "Accepted",
      total: "100.00",
      subtotal: "100.00",
      leadTimeBusinessDaysMin: 7,
      leadTimeBusinessDaysMax: 12,
    })
    .returning({ id: quotes.id });

  const [lineItem] = await db
    .insert(quoteLineItems)
    .values({
      quoteId: quote.id,
      name: "Integration test service",
      quantity: 1,
      unitPrice: "100.00",
      totalPrice: "100.00",
    })
    .returning({ id: quoteLineItems.id });

  return {
    customerId: customer.id,
    quoteId: quote.id,
    quoteLineItemId: lineItem.id,
    quoteNumber,
  };
}

export async function cleanupQuoteForConversion(
  ids: SeededConversionQuoteIds,
  orderId?: number
): Promise<void> {
  if (orderId != null) {
    const { orderLineItems, orders } = await import("~/lib/db/schema");
    await db
      .update(quotes)
      .set({ convertedToOrderId: null })
      .where(eq(quotes.id, ids.quoteId));
    await db.delete(orderLineItems).where(eq(orderLineItems.orderId, orderId));
    await db.delete(orders).where(eq(orders.id, orderId));
  }

  await db
    .delete(quoteLineItems)
    .where(eq(quoteLineItems.id, ids.quoteLineItemId));
  await db.delete(quotes).where(eq(quotes.id, ids.quoteId));
  await db.delete(customers).where(eq(customers.id, ids.customerId));
}
