import { beforeEach, describe, expect, it, vi } from "vitest";

const listLineItems = vi.fn();

vi.mock("stripe", () => ({
  default: class {
    paymentLinks = { listLineItems };
  },
}));
vi.mock("./developerSettings", () => ({ getStripeDefaults: vi.fn() }));
vi.mock("./env.server", () => ({ getEnv: vi.fn(() => "sk_test_123") }));

import { paymentLinkMatchesTotal } from "./stripe.server";

describe("paymentLinkMatchesTotal", () => {
  beforeEach(() => {
    listLineItems.mockReset();
  });

  it("is true when line item cents equal the quote total", async () => {
    listLineItems.mockResolvedValue({ data: [{ amount_total: 20000 }] });
    expect(await paymentLinkMatchesTotal("plink_1", "200.00")).toBe(true);
  });

  it("is false when the quote was re-priced", async () => {
    listLineItems.mockResolvedValue({ data: [{ amount_total: 20000 }] });
    expect(await paymentLinkMatchesTotal("plink_1", "300.00")).toBe(false);
  });

  it("rounds dollars to cents like link creation", async () => {
    listLineItems.mockResolvedValue({ data: [{ amount_total: 1999 }] });
    expect(await paymentLinkMatchesTotal("plink_1", "19.99")).toBe(true);
  });

  it("propagates Stripe errors", async () => {
    listLineItems.mockRejectedValue(new Error("rate limited"));
    await expect(paymentLinkMatchesTotal("plink_1", "200.00")).rejects.toThrow(
      "rate limited",
    );
  });
});
