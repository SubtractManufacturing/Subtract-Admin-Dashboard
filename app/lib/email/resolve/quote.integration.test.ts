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
import { db } from "~/lib/db";
import { quoteLineItems, quoteParts, quotes } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "~/lib/env.server";
import { resolveQuoteTokens } from "./quote.server";

describe("resolveQuoteTokens", () => {
  let seeded: SeededQuoteIds;

  beforeAll(async () => {
    if (!getEnv("DATABASE_URL")) {
      throw new Error(
        "DATABASE_URL or DATABASE_URL_FILE is not set. Configure a migrated Postgres instance to run integration tests.",
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

  it("resolves quote part tokens from the line item display name", async () => {
    const [quotePart] = await db
      .insert(quoteParts)
      .values({
        quoteId: seeded.quoteId,
        partNumber: "QP-DISPLAY-NAME",
        partName: "step-file-base",
        material: "6061",
      })
      .returning({ id: quoteParts.id });

    await db.insert(quoteLineItems).values({
      quoteId: seeded.quoteId,
      quotePartId: quotePart.id,
      name: "Display Name",
      quantity: 2,
      unitPrice: "10.00",
      totalPrice: "20.00",
    });

    const tokens = await resolveQuoteTokens(String(seeded.quoteId));

    expect(tokens.partNames).toBe("Display Name");
    expect(tokens.partSpecs).toContain("Name: Display Name");
    expect(tokens.partSpecs).not.toContain("Name: step-file-base");
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

  it("tolerates RFQ intake metadata without referenceNumber", async () => {
    await db
      .update(quotes)
      .set({
        creationMetadata: {
          version: 1,
          origin: "rfq_intake",
          contact: {
            email: "legacy@example.com",
            firstName: "Legacy",
            lastName: "Import",
            company: "",
            phone: "",
            jobTitle: "",
          },
          receiptNumber: "RFQ-LEGACY-1",
          submittedAt: "2026-01-01T00:00:00+00:00",
          leadTimePreference: "standard",
          destinationPostalCode: "90210",
          requestedDeliveryDate: "",
          poNumber: "PO-OLD",
          ndaRequired: false,
        },
      })
      .where(eq(quotes.id, seeded.quoteId));

    const tokens = await resolveQuoteTokens(String(seeded.quoteId));
    expect(tokens.submissionPoNumber).toBe("PO-OLD");
    expect(tokens.submissionReferenceNumber).toBeUndefined();
  });
});

describe("customer merge tokens on the Organization model (ADR-0013)", () => {
  const created: { orgIds: string[]; quoteIds: number[] } = { orgIds: [], quoteIds: [] };

  afterAll(async () => {
    const { inArray } = await import("drizzle-orm");
    const { deleteTestOrganizations } = await import("~/test/seed-organizations");
    if (created.quoteIds.length) await db.delete(quotes).where(inArray(quotes.id, created.quoteIds));
    await deleteTestOrganizations(created.orgIds);
  });

  async function quoteForCustomer(input: Parameters<typeof import("~/test/seed-organizations").createTestCustomer>[0]) {
    const { createTestCustomer } = await import("~/test/seed-organizations");
    const customer = await createTestCustomer(input);
    created.orgIds.push(customer.organizationId);
    const [quote] = await db
      .insert(quotes)
      .values({ quoteNumber: `TOK-${Date.now()}-${Math.random()}`, customerAccountId: customer.id })
      .returning({ id: quotes.id });
    created.quoteIds.push(quote.id);
    return { customer, tokens: await resolveQuoteTokens(String(quote.id)) };
  }

  it("takes the name from the Organization, reach-out details from the primary Contact and addresses from billing and default shipping", async () => {
    const { tokens } = await quoteForCustomer({
      name: "Token Works",
      kind: "business",
      contactName: "Jane Token",
      email: "jane@tokenworks.example",
      phone: "+15550101",
      paymentTerms: "Net 30",
      billingAddressLine1: "1 Bill St",
      billingCity: "Billtown",
      billingState: "IL",
      billingPostalCode: "60000",
      shippingAddressLine1: "2 Ship Rd",
      shippingCity: "Shipville",
      shippingState: "WI",
      shippingPostalCode: "53000",
    });
    expect(tokens).toMatchObject({
      customerName: "Token Works",
      customerCompanyName: "Token Works",
      customerEmail: "jane@tokenworks.example",
      customerPhone: "+15550101",
      paymentTerms: "Net 30",
    });
    expect(tokens.billingAddress).toContain("1 Bill St");
    expect(tokens.shippingAddress).toContain("2 Ship Rd");
  });

  it("leaves customerCompanyName empty for an individual", async () => {
    const { tokens } = await quoteForCustomer({
      name: "Solo Token",
      kind: "individual",
      contactName: "Solo Token",
      email: "solo@token.example",
    });
    expect(tokens.customerName).toBe("Solo Token");
    expect(tokens.customerCompanyName).toBeUndefined();
  });
});
