import { describe, it, expect, vi, beforeEach } from "vitest";
import { orderConfirmationEmailHandler } from "./order-confirmation-email.server";
import { EMAIL_CONTEXT } from "~/lib/email/email-context-registry";
import type { EmailEnqueueAuth } from "./quote-send-email.server";

const mockHasBlocking = vi.fn();
const mockGetOrder = vi.fn();
const mockGetCustomer = vi.fn();

vi.mock("~/lib/sent-emails.server", () => ({
  hasBlockingOrderContextSend: (orderId: string, ctx: string) =>
    mockHasBlocking(orderId, ctx),
}));

vi.mock("~/lib/orders", () => ({
  getOrder: (id: number) => mockGetOrder(id),
}));

vi.mock("~/lib/customers", () => ({
  getCustomer: (id: number) => mockGetCustomer(id),
}));

const auth: EmailEnqueueAuth = {
  user: { id: "u1", email: "a@b.com" } as EmailEnqueueAuth["user"],
  userDetails: {
    id: "u1",
    email: "a@b.com",
    name: "A",
    role: "Admin",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrder.mockResolvedValue({
    id: 1,
    customerId: 10,
  });
  mockGetCustomer.mockResolvedValue({ email: "c@example.com" });
  mockHasBlocking.mockResolvedValue(false);
});

describe("orderConfirmationEmailHandler.assertCanSend", () => {
  it("rejects when a blocking send already exists for this order and context", async () => {
    mockHasBlocking.mockResolvedValue(true);
    await expect(
      orderConfirmationEmailHandler.assertCanSend(auth, "1"),
    ).rejects.toThrow(/already been sent/);
    expect(mockHasBlocking).toHaveBeenCalledWith(
      "1",
      EMAIL_CONTEXT.ORDER_CONFIRMATION,
    );
  });

  it("succeeds when there is no blocking send", async () => {
    await expect(
      orderConfirmationEmailHandler.assertCanSend(auth, "1"),
    ).resolves.toBeUndefined();
  });
});
