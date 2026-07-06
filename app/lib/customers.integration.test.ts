/**
 * Integration tests: customer list sorting and quote history.
 *
 * Requires DATABASE_URL with migrations applied. Run via:
 *   DATABASE_URL=postgres://... npm run test:ci
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getCustomerQuotes, getCustomers } from "./customers";
import {
  cleanupCustomersSortFixture,
  seedCustomersSortFixture,
  type SeededCustomersSortIds,
} from "~/test/seed-customers-sort";

describe("customer quote history", () => {
  let seeded: SeededCustomersSortIds;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set. Set it to a migrated local Postgres instance to run integration tests.",
      );
    }

    seeded = await seedCustomersSortFixture();
  });

  afterAll(async () => {
    if (seeded) {
      await cleanupCustomersSortFixture(seeded);
    }
  });

  it("returns a customer's quotes newest first", async () => {
    const customerQuotes = await getCustomerQuotes(seeded.alphaCustomerId);

    expect(customerQuotes.map((quote) => quote.quoteNumber)).toEqual([
      expect.stringContaining("Q-ALPHA-NEW"),
      expect.stringContaining("Q-ALPHA-OLD"),
    ]);
  });

  it("excludes archived quotes from customer history", async () => {
    const customerQuotes = await getCustomerQuotes(seeded.alphaCustomerId);

    expect(customerQuotes.map((quote) => quote.quoteNumber)).not.toContain(
      expect.stringContaining("Q-ALPHA-ARCHIVED"),
    );
  });

  it("returns an empty list for customers with no quotes", async () => {
    await expect(getCustomerQuotes(seeded.gammaCustomerId)).resolves.toEqual([]);
  });
});

describe("customer list sorting", () => {
  let seeded: SeededCustomersSortIds;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set. Set it to a migrated local Postgres instance to run integration tests.",
      );
    }

    seeded = await seedCustomersSortFixture();
  });

  afterAll(async () => {
    if (seeded) {
      await cleanupCustomersSortFixture(seeded);
    }
  });

  it("sorts customers alphabetically by display name", async () => {
    const sortedCustomers = (await getCustomers({ sortBy: "name" })).filter(
      (customer) => seeded.customerIds.includes(customer.id),
    );

    expect(sortedCustomers.map((customer) => customer.id)).toEqual([
      seeded.alphaCustomerId,
      seeded.betaCustomerId,
      seeded.gammaCustomerId,
    ]);
  });

  it("sorts customers by their most recent order and puts customers with no orders last", async () => {
    const sortedCustomers = (await getCustomers({ sortBy: "recentOrders" })).filter(
      (customer) => seeded.customerIds.includes(customer.id),
    );

    expect(sortedCustomers.map((customer) => customer.id)).toEqual([
      seeded.betaCustomerId,
      seeded.alphaCustomerId,
      seeded.gammaCustomerId,
    ]);
  });

  it("sorts customers by their most recent non-archived quote and puts customers with no quotes last", async () => {
    const sortedCustomers = (await getCustomers({ sortBy: "recentQuotes" })).filter(
      (customer) => seeded.customerIds.includes(customer.id),
    );

    expect(sortedCustomers.map((customer) => customer.id)).toEqual([
      seeded.alphaCustomerId,
      seeded.betaCustomerId,
      seeded.gammaCustomerId,
    ]);
  });

  it("keeps the default customer list sort newest first", async () => {
    const sortedCustomers = (await getCustomers({ sortBy: "default" })).filter(
      (customer) => seeded.customerIds.includes(customer.id),
    );

    expect(sortedCustomers.map((customer) => customer.id)).toEqual([
      seeded.gammaCustomerId,
      seeded.betaCustomerId,
      seeded.alphaCustomerId,
    ]);
  });
});
