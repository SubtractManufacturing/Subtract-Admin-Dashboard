import { describe, expect, it, vi } from "vitest";
import type { IntentTable } from "~/lib/route-actions/core";
import type { QuoteCtx, QuoteEntity } from "../context";
import { locationOf, makeQuoteCtx, oversizedFile, runIntent } from "../test-support";
import { receivePoIntents } from "./receive-po";

const run = (ctx: QuoteCtx, intent: string, fields: Record<string, string | Blob> = {}) =>
  runIntent(receivePoIntents as IntentTable<QuoteCtx>, ctx, intent, fields);

const sentQuote = {
  status: "Sent",
  total: "500.00",
  lineItems: [{ id: 1 }],
  parts: [],
  stripePaymentLinkId: "plink_1",
} as unknown as Partial<QuoteEntity>;

const po = new File(["%PDF"], "po.pdf", { type: "application/pdf" });
const form = { poNumber: " PO-77 ", file: po };

describe("receivePo", () => {
  it("converts the quote, attaching the customer PO", async () => {
    const ctx = makeQuoteCtx({ quote: sentQuote });
    vi.mocked(ctx.deps.stripe.enabled).mockResolvedValue(true);

    const res = await run(ctx, "receivePo", form);

    expect(ctx.deps.attachments.create).toHaveBeenCalledWith(
      expect.objectContaining({ documentKind: "customer_purchase_order" }),
      ctx.actor,
    );
    expect(ctx.deps.attachments.linkToQuote).toHaveBeenCalledWith(7, "att-1");
    expect(ctx.deps.stripe.deactivatePaymentLink).toHaveBeenCalledWith("plink_1");
    expect(ctx.deps.quotes.convertToOrder).toHaveBeenCalledWith(7, ctx.actor, {
      poNumber: "PO-77",
      viaCustomerPo: true,
      customerPoAttachmentId: "att-1",
    });
    expect(locationOf(res)).toBe("/orders/25Z00001");
  });

  it.each([
    ["Draft", "Quote must be Sent to receive a customer PO"],
    ["Accepted", "Quote must be Sent to receive a customer PO"],
  ])("refuses a %s quote", async (status, error) => {
    const ctx = makeQuoteCtx({ quote: { ...sentQuote, status } as never });
    const res = await run(ctx, "receivePo", form);
    expect(await res.json()).toEqual({ error });
  });

  it("refuses a quote that is already converted", async () => {
    const ctx = makeQuoteCtx({ quote: { ...sentQuote, convertedToOrderId: 4 } as never });
    const res = await run(ctx, "receivePo", form);
    expect(await res.json()).toEqual({ error: "Quote has already been converted to an order" });
  });

  it("validates PO number, file presence, size and type before storing anything", async () => {
    const ctx = makeQuoteCtx({ quote: sentQuote });
    const cases: Array<[Record<string, string | Blob>, string]> = [
      [{ file: po }, "PO number is required"],
      [{ poNumber: "1" }, "Customer PO file is required"],
      [{ poNumber: "1", file: oversizedFile() }, "File size exceeds 10MB limit"],
      [
        { poNumber: "1", file: new File(["x"], "po.exe", { type: "application/x-msdownload" }) },
        "Customer PO must be a PDF or image (PNG, JPG, or WebP)",
      ],
    ];
    for (const [fields, error] of cases) {
      const res = await run(ctx, "receivePo", fields);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    expect(ctx.deps.files.upload).not.toHaveBeenCalled();
  });

  it("does not store the PO when the quote fails acceptance checks", async () => {
    const ctx = makeQuoteCtx({ quote: { ...sentQuote, total: "0" } as never });
    const res = await run(ctx, "receivePo", form);
    const body = await res.json();
    expect(body.error).toBe("Cannot accept quote");
    expect(body.validationErrors).toHaveLength(1);
    expect(ctx.deps.files.upload).not.toHaveBeenCalled();
    expect(ctx.deps.quotes.convertToOrder).not.toHaveBeenCalled();
  });

  it("reports a conversion failure", async () => {
    const ctx = makeQuoteCtx({ quote: sentQuote });
    vi.mocked(ctx.deps.quotes.convertToOrder).mockResolvedValue({
      success: false,
      error: "Customer missing",
    });
    const res = await run(ctx, "receivePo", form);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Customer missing" });
  });

  it("answers 500 when storing the PO fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeQuoteCtx({ quote: sentQuote });
    vi.mocked(ctx.deps.files.upload).mockRejectedValue(new Error("s3"));
    const res = await run(ctx, "receivePo", form);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to receive customer PO" });
    expect(ctx.deps.quotes.convertToOrder).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
