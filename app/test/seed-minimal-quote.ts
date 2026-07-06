/**
 * Integration test seed helpers.
 *
 * Inserts the minimum rows needed for resolveQuoteTokens tests and returns
 * ids for cleanup. Uses Drizzle insert().returning() — no raw SQL.
 *
 * Call cleanupMinimalQuote(ids) in afterAll to delete inserted rows.
 */

import { db } from "~/lib/db";
import { customers, quoteLineItems, quoteParts, quotes } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

export type SeededQuoteIds = {
  customerId: number;
  quoteId: number;
  quoteNumber: string;
  customerName: string;
};

/**
 * Inserts one customer and one quote, returning their ids and the values
 * used so tests can assert against known data.
 */
export async function seedMinimalQuote(): Promise<SeededQuoteIds> {
  const quoteNumber = `TEST-${Date.now()}`;
  const customerName = "Test Integration Co";

  const [customer] = await db
    .insert(customers)
    .values({ displayName: customerName })
    .returning({ id: customers.id });

  const [quote] = await db
    .insert(quotes)
    .values({
      quoteNumber,
      customerId: customer.id,
      status: "RFQ",
      total: "100.00",
      subtotal: "90.00",
      leadTimeBusinessDaysMin: 7,
      leadTimeBusinessDaysMax: 12,
    })
    .returning({ id: quotes.id });

  return {
    customerId: customer.id,
    quoteId: quote.id,
    quoteNumber,
    customerName,
  };
}

/**
 * Deletes the rows inserted by seedMinimalQuote in the correct FK order.
 */
export async function cleanupMinimalQuote(ids: SeededQuoteIds): Promise<void> {
  await db.delete(quoteLineItems).where(eq(quoteLineItems.quoteId, ids.quoteId));
  await db.delete(quoteParts).where(eq(quoteParts.quoteId, ids.quoteId));
  await db.delete(quotes).where(eq(quotes.id, ids.quoteId));
  await db.delete(customers).where(eq(customers.id, ids.customerId));
}
