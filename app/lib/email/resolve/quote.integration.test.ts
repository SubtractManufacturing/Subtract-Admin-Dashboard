/**
 * Integration test: resolveQuoteTokens
 *
 * Requires a running Postgres database accessible via DATABASE_URL with
 * migrations already applied. Run via:
 *   DATABASE_URL=postgres://... npm run test:ci
 *
 * In CI this is handled by the "Tests (Vitest + Postgres)" job in pr-checks.yml.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SeededQuoteIds } from "~/test/seed-minimal-quote";
import { seedMinimalQuote, cleanupMinimalQuote } from "~/test/seed-minimal-quote";
import { resolveQuoteTokens } from "./quote.server";

describe("resolveQuoteTokens", () => {
  let seeded: SeededQuoteIds;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set. Set it to a migrated local Postgres instance to run integration tests.",
      );
    }
    seeded = await seedMinimalQuote();
  });

  afterAll(async () => {
    if (seeded) {
      await cleanupMinimalQuote(seeded);
    }
  });

  it("resolves documentNumber and quoteNumber to the seeded quoteNumber", async () => {
    const tokens = await resolveQuoteTokens(String(seeded.quoteId));
    expect(tokens.quoteNumber).toBe(seeded.quoteNumber);
    expect(tokens.documentNumber).toBe(seeded.quoteNumber);
  });

  it("resolves documentStatus to 'RFQ'", async () => {
    const tokens = await resolveQuoteTokens(String(seeded.quoteId));
    expect(tokens.documentStatus).toBe("RFQ");
  });

  it("resolves customerName to the seeded customer displayName", async () => {
    const tokens = await resolveQuoteTokens(String(seeded.quoteId));
    expect(tokens.customerName).toBe(seeded.customerName);
  });

  it("resolves total as a formatted currency string", async () => {
    const tokens = await resolveQuoteTokens(String(seeded.quoteId));
    expect(tokens.total).toBe("$100.00");
  });

  it("resolves subtotal as a formatted currency string", async () => {
    const tokens = await resolveQuoteTokens(String(seeded.quoteId));
    expect(tokens.subtotal).toBe("$90.00");
  });

  it("resolves documentDate as a readable date string", async () => {
    const tokens = await resolveQuoteTokens(String(seeded.quoteId));
    expect(tokens.documentDate).toBeDefined();
    // Should be in "Month D, YYYY" format
    expect(tokens.documentDate).toMatch(/\w+ \d+, \d{4}/);
  });

  it("throws for an invalid (non-numeric) entity id", async () => {
    await expect(resolveQuoteTokens("not-a-number")).rejects.toThrow("Invalid quote id");
  });

  it("throws for a quote id that does not exist", async () => {
    await expect(resolveQuoteTokens("99999999")).rejects.toThrow("Quote not found");
  });

  it("resolves estimatedDeliveryDate and leadTimeBusinessDays from seeded lead time", async () => {
    const tokens = await resolveQuoteTokens(String(seeded.quoteId));
    expect(tokens.estimatedDeliveryDate).toBeDefined();
    expect(tokens.estimatedDeliveryDate).not.toMatch(/\(ET\)/);
    expect(tokens.leadTimeBusinessDays).toBe("7–12 Business Days");
  });
});
