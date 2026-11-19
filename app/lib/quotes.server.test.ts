import { testUuid } from "~/test/ids";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ db: {} }));
vi.mock("./events", () => ({ getEventsByEntity: vi.fn() }));
vi.mock("./featureFlags", () => ({
  isStripePaymentLinksEnabled: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("./quotes", () => ({ getQuote: vi.fn(), updateQuote: vi.fn() }));
vi.mock("~/lib/stripe.server", () => ({
  isStripeConfigured: vi.fn(() => true),
  createQuotePaymentLink: vi.fn(),
  deactivateQuotePaymentLink: vi.fn(),
  paymentLinkMatchesTotal: vi.fn(),
}));

import {
  ensureQuoteStripePaymentLink,
  transitionQuoteToSent,
} from "./quotes.server";
import { getQuote, updateQuote } from "./quotes";
import {
  createQuotePaymentLink,
  deactivateQuotePaymentLink,
  paymentLinkMatchesTotal,
} from "~/lib/stripe.server";

const quote = {
  id: 7,
  quoteNumber: "25Q00007",
  customerAccountId: testUuid(3),
  total: "200.00",
  stripePaymentLinkId: "plink_old",
  stripePaymentLinkActive: true,
  stripePaymentLinkUrl: "https://buy.stripe.com/old",
};

describe("ensureQuoteStripePaymentLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getQuote).mockResolvedValue(quote as never);
    vi.mocked(updateQuote).mockResolvedValue({} as never);
    vi.mocked(createQuotePaymentLink).mockResolvedValue({
      id: "plink_new",
      url: "https://buy.stripe.com/new",
    });
  });

  it("reuses an active link whose amount still matches the total", async () => {
    vi.mocked(paymentLinkMatchesTotal).mockResolvedValue(true);

    const result = await ensureQuoteStripePaymentLink(7, {});

    expect(result).toEqual({ success: true });
    expect(createQuotePaymentLink).not.toHaveBeenCalled();
    expect(deactivateQuotePaymentLink).not.toHaveBeenCalled();
  });

  it("replaces an active link when the quote total has changed", async () => {
    vi.mocked(paymentLinkMatchesTotal).mockResolvedValue(false);

    const result = await ensureQuoteStripePaymentLink(7, {});

    expect(result).toEqual({ success: true });
    expect(deactivateQuotePaymentLink).toHaveBeenCalledWith("plink_old");
    expect(updateQuote).toHaveBeenNthCalledWith(
      1,
      7,
      { stripePaymentLinkActive: false },
      {},
    );
    expect(createQuotePaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ totalDollars: "200.00" }),
    );
    expect(updateQuote).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        stripePaymentLinkId: "plink_new",
        stripePaymentLinkUrl: "https://buy.stripe.com/new",
        stripePaymentLinkActive: true,
      }),
      {},
    );
  });

  it("fails without replacing the link when the Stripe lookup throws", async () => {
    vi.mocked(paymentLinkMatchesTotal).mockRejectedValue(new Error("rate limited"));

    const result = await ensureQuoteStripePaymentLink(7, {});

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("rate limited"),
    });
    expect(deactivateQuotePaymentLink).not.toHaveBeenCalled();
    expect(createQuotePaymentLink).not.toHaveBeenCalled();
    expect(updateQuote).not.toHaveBeenCalled();
  });

  it("fails without replacing the link when deactivating a stale link throws", async () => {
    vi.mocked(paymentLinkMatchesTotal).mockResolvedValue(false);
    vi.mocked(deactivateQuotePaymentLink).mockRejectedValue(new Error("boom"));

    const result = await ensureQuoteStripePaymentLink(7, {});

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("boom"),
    });
    expect(createQuotePaymentLink).not.toHaveBeenCalled();
    expect(updateQuote).not.toHaveBeenCalled();
  });

  it("does not query Stripe amounts when the quote has no link yet", async () => {
    vi.mocked(getQuote).mockResolvedValue({
      ...quote,
      stripePaymentLinkId: null,
      stripePaymentLinkActive: null,
      stripePaymentLinkUrl: null,
    } as never);

    await ensureQuoteStripePaymentLink(7, {});

    expect(paymentLinkMatchesTotal).not.toHaveBeenCalled();
    expect(createQuotePaymentLink).toHaveBeenCalled();
  });
});

describe("transitionQuoteToSent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getQuote).mockResolvedValue(quote as never);
    vi.mocked(updateQuote).mockResolvedValue({} as never);
  });

  it("keeps an existing active link untouched (already in the delivered email)", async () => {
    const result = await transitionQuoteToSent(7, {});

    expect(result).toEqual({ success: true });
    expect(paymentLinkMatchesTotal).not.toHaveBeenCalled();
    expect(deactivateQuotePaymentLink).not.toHaveBeenCalled();
    expect(createQuotePaymentLink).not.toHaveBeenCalled();
    expect(updateQuote).toHaveBeenCalledWith(
      7,
      { status: "Sent", rejectionReason: null },
      {},
    );
  });
});
