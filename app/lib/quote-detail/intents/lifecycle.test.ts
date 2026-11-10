import { describe, expect, it, vi } from "vitest";
import { addBusinessDays } from "~/lib/business-days";
import type { IntentTable } from "~/lib/route-actions/core";
import type { QuoteCtx, QuoteEntity } from "../context";
import { locationOf, makeQuoteCtx, runIntent } from "../test-support";
import { lifecycleIntents } from "./lifecycle";

const run = (ctx: QuoteCtx, intent: string, fields: Record<string, string> = {}) =>
  runIntent(lifecycleIntents as IntentTable<QuoteCtx>, ctx, intent, fields);

/** A quote that passes the acceptance checks. */
const priced = {
  total: "250.00",
  lineItems: [{ id: 1 }],
  parts: [],
} as unknown as Partial<QuoteEntity>;

describe("updateStatus", () => {
  it("rejects an unknown status", async () => {
    const ctx = makeQuoteCtx();
    const res = await run(ctx, "updateStatus", { status: "Bogus" });
    expect(res.status).toBe(400);
    expect(ctx.deps.quotes.update).not.toHaveBeenCalled();
  });

  it("sends via the Sent transition and redirects back", async () => {
    const ctx = makeQuoteCtx();
    const res = await run(ctx, "updateStatus", { status: "Sent" });
    expect(ctx.deps.quotes.transitionToSent).toHaveBeenCalledWith(7, ctx.actor);
    expect(res.status).toBe(302);
    expect(locationOf(res)).toBe("/quotes/7");
  });

  it("surfaces a failed Sent transition", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.quotes.transitionToSent).mockResolvedValue({
      success: false,
      error: "No customer email",
    });
    const res = await run(ctx, "updateStatus", { status: "Sent" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No customer email" });
  });

  it("stores a rejection reason only for Rejected", async () => {
    const ctx = makeQuoteCtx();
    await run(ctx, "updateStatus", { status: "Rejected", rejectionReason: "Too pricey" });
    expect(ctx.deps.quotes.update).toHaveBeenLastCalledWith(
      7,
      { status: "Rejected", rejectionReason: "Too pricey" },
      ctx.actor,
    );

    await run(ctx, "updateStatus", { status: "Dropped", rejectionReason: "ignored" });
    expect(ctx.deps.quotes.update).toHaveBeenLastCalledWith(
      7,
      { status: "Dropped", rejectionReason: null },
      ctx.actor,
    );
  });

  describe("Accepted", () => {
    it("refuses to convert a quote that fails acceptance checks", async () => {
      const ctx = makeQuoteCtx({ quote: { total: "0", lineItems: [] } });
      const res = await run(ctx, "updateStatus", { status: "Accepted" });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Cannot accept quote");
      expect(body.validationErrors).toHaveLength(2);
      expect(ctx.deps.quotes.convertToOrder).not.toHaveBeenCalled();
      expect(ctx.deps.quotes.update).not.toHaveBeenCalled();
    });

    it("converts and redirects to the new order", async () => {
      const ctx = makeQuoteCtx({ quote: priced });
      const res = await run(ctx, "updateStatus", { status: "Accepted" });
      expect(ctx.deps.quotes.convertToOrder).toHaveBeenCalledWith(7, ctx.actor, undefined);
      expect(locationOf(res)).toBe("/orders/25Z00001");
    });

    it("reports a conversion failure without touching status", async () => {
      const ctx = makeQuoteCtx({ quote: priced });
      vi.mocked(ctx.deps.quotes.convertToOrder).mockResolvedValue({
        success: false,
        error: "Customer missing address",
      });
      const res = await run(ctx, "updateStatus", { status: "Accepted" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Customer missing address" });
      expect(ctx.deps.quotes.update).not.toHaveBeenCalled();
    });
  });

  describe("Stripe payment link", () => {
    const withLink = { stripePaymentLinkId: "plink_1" } as const;

    it.each(["Accepted", "Rejected", "Expired"])("is deactivated on %s", async (status) => {
      const ctx = makeQuoteCtx({ quote: { ...withLink, ...priced } });
      vi.mocked(ctx.deps.stripe.enabled).mockResolvedValue(true);
      await run(ctx, "updateStatus", { status });
      expect(ctx.deps.stripe.deactivatePaymentLink).toHaveBeenCalledWith("plink_1");
      expect(ctx.deps.quotes.update).toHaveBeenCalledWith(
        7,
        { stripePaymentLinkActive: false },
        ctx.actor,
      );
    });

    it("is left alone for non-closing statuses", async () => {
      const ctx = makeQuoteCtx({ quote: withLink });
      vi.mocked(ctx.deps.stripe.enabled).mockResolvedValue(true);
      await run(ctx, "updateStatus", { status: "Dropped" });
      expect(ctx.deps.stripe.deactivatePaymentLink).not.toHaveBeenCalled();
    });

    it("is left alone when Stripe is disabled", async () => {
      const ctx = makeQuoteCtx({ quote: withLink });
      await run(ctx, "updateStatus", { status: "Rejected" });
      expect(ctx.deps.stripe.deactivatePaymentLink).not.toHaveBeenCalled();
    });

    it("does not block the status change when Stripe fails", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const ctx = makeQuoteCtx({ quote: withLink });
      vi.mocked(ctx.deps.stripe.enabled).mockResolvedValue(true);
      vi.mocked(ctx.deps.stripe.deactivatePaymentLink).mockRejectedValue(new Error("stripe down"));
      const res = await run(ctx, "updateStatus", { status: "Rejected", rejectionReason: "x" });
      expect(res.status).toBe(302);
      expect(ctx.deps.quotes.update).toHaveBeenCalledWith(
        7,
        { status: "Rejected", rejectionReason: "x" },
        ctx.actor,
      );
      spy.mockRestore();
    });
  });
});

describe("editing an RFQ", () => {
  it.each([
    ["updateQuote", { expirationDays: "30" }],
    ["updateCustomer", { customerId: "2" }],
    ["updateVendor", { vendorId: "3" }],
    ["updateValidUntil", { validUntil: "2026-12-31" }],
    ["updateEstimatedDelivery", { leadTimeBusinessDaysMin: "3", leadTimeBusinessDaysMax: "5" }],
  ])("%s promotes it to Draft first", async (intent, fields) => {
    const ctx = makeQuoteCtx({ quote: { status: "RFQ" } });
    await run(ctx, intent, fields);
    expect(vi.mocked(ctx.deps.quotes.update).mock.calls[0]).toEqual([
      7,
      { status: "Draft" },
      ctx.actor,
    ]);
  });

  it("leaves a Draft alone", async () => {
    const ctx = makeQuoteCtx();
    await run(ctx, "updateCustomer", { customerId: "2" });
    expect(ctx.deps.quotes.update).toHaveBeenCalledTimes(1);
  });
});

describe("header fields", () => {
  it("validates expiration days", async () => {
    for (const expirationDays of ["0", "366", "x"]) {
      const ctx = makeQuoteCtx();
      const res = await run(ctx, "updateQuote", { expirationDays });
      expect(res.status).toBe(400);
      expect(ctx.deps.quotes.update).not.toHaveBeenCalled();
    }
  });

  it("requires a customer and a valid date", async () => {
    const ctx = makeQuoteCtx();
    expect((await run(ctx, "updateCustomer")).status).toBe(400);
    expect((await run(ctx, "updateCustomer", { customerId: "zz" })).status).toBe(400);
    expect((await run(ctx, "updateValidUntil")).status).toBe(400);
    expect((await run(ctx, "updateValidUntil", { validUntil: "not-a-date" })).status).toBe(400);
    expect(ctx.deps.quotes.update).not.toHaveBeenCalled();
  });

  it("clears the vendor when none is posted", async () => {
    const ctx = makeQuoteCtx({ quote: { vendorId: 4 } });
    await run(ctx, "updateVendor", { vendorId: "" });
    expect(ctx.deps.quotes.update).toHaveBeenCalledWith(7, { vendorId: null }, ctx.actor);
  });

  it("derives the delivery window from business days after today", async () => {
    const ctx = makeQuoteCtx();
    const today = new Date("2026-03-02T00:00:00");
    vi.mocked(ctx.deps.clock.today).mockReturnValue(today);
    await run(ctx, "updateEstimatedDelivery", {
      leadTimeBusinessDaysMin: "3",
      leadTimeBusinessDaysMax: "10",
    });
    expect(ctx.deps.quotes.update).toHaveBeenCalledWith(
      7,
      {
        leadTimeBusinessDaysMin: 3,
        leadTimeBusinessDaysMax: 10,
        estimatedDeliveryDateStart: addBusinessDays(today, 3),
        estimatedDeliveryDateEnd: addBusinessDays(today, 10),
      },
      ctx.actor,
    );
  });

  it("rejects an inverted or negative lead time range", async () => {
    for (const [min, max] of [["5", "3"], ["-1", "3"], ["a", "3"]]) {
      const ctx = makeQuoteCtx();
      const res = await run(ctx, "updateEstimatedDelivery", {
        leadTimeBusinessDaysMin: min,
        leadTimeBusinessDaysMax: max,
      });
      expect(res.status).toBe(400);
    }
  });

  it("toggles NDA required", async () => {
    const ctx = makeQuoteCtx();
    await run(ctx, "updateNdaRequired", { ndaRequired: "true" });
    expect(ctx.deps.quotes.update).toHaveBeenCalledWith(7, { ndaRequired: true }, ctx.actor);
    await run(ctx, "updateNdaRequired", { ndaRequired: "false" });
    expect(ctx.deps.quotes.update).toHaveBeenLastCalledWith(7, { ndaRequired: false }, ctx.actor);
  });
});

describe("reviseQuote", () => {
  it.each(["RFQ", "Draft", "Accepted"] as const)("is refused for %s", async (status) => {
    const ctx = makeQuoteCtx({ quote: { status } });
    const res = await run(ctx, "reviseQuote");
    expect(res.status).toBe(400);
    expect(ctx.deps.quotes.resetToDraftForRevision).not.toHaveBeenCalled();
  });

  it("reverts a Sent quote to Draft, closes the payment link and logs an event", async () => {
    const ctx = makeQuoteCtx({
      quote: { status: "Sent", stripePaymentLinkId: "plink_9", stripePaymentLinkActive: true },
    });
    vi.mocked(ctx.deps.stripe.enabled).mockResolvedValue(true);

    const res = await run(ctx, "reviseQuote");

    expect(ctx.deps.stripe.deactivatePaymentLink).toHaveBeenCalledWith("plink_9");
    expect(ctx.deps.quotes.resetToDraftForRevision).toHaveBeenCalledWith(7);
    expect(ctx.deps.events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "quote",
        entityId: "7",
        eventType: "quote_revised",
        metadata: { oldStatus: "Sent", newStatus: "Draft", quoteNumber: "25Q00007" },
      }),
    );
    expect(locationOf(res)).toBe("/quotes/7");
  });

  it("skips Stripe when the link is not active", async () => {
    const ctx = makeQuoteCtx({
      quote: { status: "Sent", stripePaymentLinkId: "plink_9", stripePaymentLinkActive: false },
    });
    vi.mocked(ctx.deps.stripe.enabled).mockResolvedValue(true);
    await run(ctx, "reviseQuote");
    expect(ctx.deps.stripe.deactivatePaymentLink).not.toHaveBeenCalled();
  });
});

describe("conversion, duplication, archive", () => {
  it("convertToOrder redirects to the order", async () => {
    const ctx = makeQuoteCtx();
    expect(locationOf(await run(ctx, "convertToOrder"))).toBe("/orders/25Z00001");
  });

  it("duplicateQuote redirects to the copy", async () => {
    const ctx = makeQuoteCtx();
    expect(locationOf(await run(ctx, "duplicateQuote"))).toBe("/quotes/8");
  });

  it("duplicateQuote reports failure", async () => {
    const ctx = makeQuoteCtx();
    vi.mocked(ctx.deps.quotes.duplicate).mockResolvedValue({ success: false, error: "nope" });
    const res = await run(ctx, "duplicateQuote");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "nope" });
  });

  it("archive sends you to the list, restore back to the quote", async () => {
    const ctx = makeQuoteCtx();
    expect(locationOf(await run(ctx, "archiveQuote"))).toBe("/quotes");
    expect(locationOf(await run(ctx, "restoreQuote"))).toBe("/quotes/7");
  });
});
