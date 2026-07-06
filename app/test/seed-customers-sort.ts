import { inArray } from "drizzle-orm";

import { db } from "~/lib/db";
import { customers, orders, quotes } from "~/lib/db/schema";

export type SeededCustomersSortIds = {
  alphaCustomerId: number;
  betaCustomerId: number;
  gammaCustomerId: number;
  customerIds: number[];
  quoteIds: number[];
  orderIds: number[];
};

export async function seedCustomersSortFixture(): Promise<SeededCustomersSortIds> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const seededCustomers = await db
    .insert(customers)
    .values([
      {
        displayName: `Alpha Fabrication ${suffix}`,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        displayName: `Beta Machine ${suffix}`,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      {
        displayName: `Gamma No Activity ${suffix}`,
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    ])
    .returning({ id: customers.id });

  const [alphaCustomer, betaCustomer, gammaCustomer] = seededCustomers;

  const seededQuotes = await db
    .insert(quotes)
    .values([
      {
        quoteNumber: `Q-ALPHA-OLD-${suffix}`,
        customerId: alphaCustomer.id,
        status: "Draft",
        total: "120.00",
        validUntil: new Date("2026-04-01T00:00:00.000Z"),
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      },
      {
        quoteNumber: `Q-ALPHA-NEW-${suffix}`,
        customerId: alphaCustomer.id,
        status: "RFQ",
        total: "250.00",
        validUntil: new Date("2026-04-15T00:00:00.000Z"),
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
      },
      {
        quoteNumber: `Q-ALPHA-ARCHIVED-${suffix}`,
        customerId: alphaCustomer.id,
        status: "Expired",
        total: "999.00",
        isArchived: true,
        createdAt: new Date("2026-03-20T00:00:00.000Z"),
      },
      {
        quoteNumber: `Q-BETA-${suffix}`,
        customerId: betaCustomer.id,
        status: "Sent",
        total: "300.00",
        validUntil: new Date("2026-03-20T00:00:00.000Z"),
        createdAt: new Date("2026-02-15T00:00:00.000Z"),
      },
    ])
    .returning({ id: quotes.id });

  const seededOrders = await db
    .insert(orders)
    .values([
      {
        orderNumber: `O-ALPHA-${suffix}`,
        customerId: alphaCustomer.id,
        status: "Pending",
        totalPrice: "75.00",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
      {
        orderNumber: `O-BETA-${suffix}`,
        customerId: betaCustomer.id,
        status: "Pending",
        totalPrice: "125.00",
        createdAt: new Date("2026-02-10T00:00:00.000Z"),
      },
    ])
    .returning({ id: orders.id });

  return {
    alphaCustomerId: alphaCustomer.id,
    betaCustomerId: betaCustomer.id,
    gammaCustomerId: gammaCustomer.id,
    customerIds: seededCustomers.map((customer) => customer.id),
    quoteIds: seededQuotes.map((quote) => quote.id),
    orderIds: seededOrders.map((order) => order.id),
  };
}

export async function cleanupCustomersSortFixture(
  ids: SeededCustomersSortIds,
): Promise<void> {
  await db.delete(orders).where(inArray(orders.id, ids.orderIds));
  await db.delete(quotes).where(inArray(quotes.id, ids.quoteIds));
  await db.delete(customers).where(inArray(customers.id, ids.customerIds));
}
