/**
 * Integration test: convertQuoteToOrder delivery fields
 *
 * Requires DATABASE_URL with migrations applied. Run via:
 *   DATABASE_URL=postgres://... npm run test:ci
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { businessDaysFrom } from "./business-days";
import { getOrder } from "./orders";
import { convertQuoteToOrder } from "./quotes";
import type { SeededConversionQuoteIds } from "~/test/seed-quote-for-conversion";
import {
  cleanupQuoteForConversion,
  seedQuoteForConversion,
} from "~/test/seed-quote-for-conversion";

describe("convertQuoteToOrder delivery fields", () => {
  let seeded: SeededConversionQuoteIds;
  let convertedOrderId: number | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set. Set it to a migrated local Postgres instance to run integration tests.",
      );
    }
    seeded = await seedQuoteForConversion();
  });

  afterAll(async () => {
    if (seeded) {
      await cleanupQuoteForConversion(seeded, convertedOrderId);
    }
  });

  it("copies lead time range to order delivery fields anchored on placement", async () => {
    const result = await convertQuoteToOrder(seeded.quoteId);
    expect(result.success).toBe(true);
    expect(result.orderId).toBeDefined();

    convertedOrderId = result.orderId;
    const order = await getOrder(result.orderId!);
    expect(order).not.toBeNull();
    expect(order!.deliveryDate).not.toBeNull();
    expect(order!.deliveryDateStart).not.toBeNull();
    expect(order!.leadTimeBusinessDaysMin).toBe(7);
    expect(order!.leadTime).not.toBeNull();
    expect(order!.leadTime).toBe(
      businessDaysFrom(order!.createdAt, order!.deliveryDate!)
    );
  });
});
