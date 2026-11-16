import { describe, expect, it, vi } from "vitest";
import { isJobBoardEligible, loadOrderDetail, type OrderLoaderDeps } from "./loader";
import { makeOrder, testAuth } from "./test-support";

const drawing = (id: string) => ({
  attachment: {
    id,
    fileName: `${id}.pdf`,
    contentType: "application/pdf",
    fileSize: 10,
    s3Key: `drawings/${id}.pdf`,
    thumbnailS3Key: null,
  },
});

const lineItem = (id: number, part: Record<string, unknown> | null) => ({
  lineItem: { id, orderId: 12 },
  part,
});

/** Every port a `vi.fn` with a harmless default. */
function fakeDeps(order: ReturnType<typeof makeOrder> | null = makeOrder()) {
  const deps = {
    orders: {
      getByNumber: vi.fn(async () => order),
      lineItems: vi.fn(async (): Promise<unknown[]> => []),
      trackingNumbers: vi.fn(async () => []),
      archivedLineItems: vi.fn(async () => []),
      archiveRetentionDays: vi.fn(async () => 30),
      sourceQuote: vi.fn(
        async (): Promise<{
          quoteNumber: string | null;
          stripePaymentLinkId: string | null;
        } | null> => ({ quoteNumber: "25Q00007", stripePaymentLinkId: "plink_1" }),
      ),
    },
    directory: {
      customer: vi.fn(async () => ({ id: 3, displayName: "Acme" })),
      vendor: vi.fn(async () => ({ id: 9, displayName: "Shop" })),
      vendors: vi.fn(async () => []),
    },
    parts: {
      forCustomer: vi.fn(async (): Promise<unknown[]> => []),
      hydrateThumbnails: vi.fn(async (parts: Array<Record<string, unknown>>) =>
        parts.map((part) => ({
          ...part,
          thumbnailUrl: part.thumbnailUrl ? `signed:${part.thumbnailUrl}` : part.thumbnailUrl,
        })),
      ),
      drawingRecords: vi.fn(async (): Promise<Array<ReturnType<typeof drawing>>> => []),
    },
    notes: vi.fn(async () => []),
    events: vi.fn(async () => []),
    flags: {
      cadRevision: vi.fn(async () => false),
      pdfAutoDownload: vi.fn(async () => false),
      bananaForScale: vi.fn(async () => false),
      stripePaymentLinks: vi.fn(async () => false),
      stripeConfigured: vi.fn(() => false),
      outboundEmail: vi.fn(async () => false),
      hideLineItemThumbnails: vi.fn(async () => false),
    },
    sign: vi.fn(async (key: string) => `signed:${key}`),
    bananaModel: vi.fn(async () => ({
      cadUrl: null,
      meshUrl: "banana/mesh.glb",
      conversionStatus: "completed",
    })),
    jobBoard: {
      orderInput: vi.fn(async () => ({ orderNumber: "26Z00012" })),
      settings: vi.fn(async () => ({
        webhook: { configured: true },
        notifyRoleId: "role-1",
      })),
    },
    email: {
      composer: {
        resolveTemplate: vi.fn(async () => ({
          layoutSlug: "order",
          template: { subjectTemplate: "Order {{orderNumber}} for {{customerName}}: {{total}}" },
        })),
        mergeFields: vi.fn(async () => ({})),
        interpolate: (template: string, vars: Record<string, string>) =>
          template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? ""),
        layoutSlots: () => [],
        parseBodyCopy: () => ({ ok: true as const, data: {} }),
      },
      actorMerge: vi.fn(async ({ email }: { email: string }) => ({
        userName: "Ops",
        userEmail: email,
      })),
      confirmationSendBlocked: vi.fn(async () => false),
    },
  };
  return deps as unknown as typeof deps & OrderLoaderDeps;
}

const load = (deps: OrderLoaderDeps, orderNumber: string | undefined = "26Z00012") =>
  loadOrderDetail({ orderNumber, ...testAuth }, deps);

const thrownStatus = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (thrown) {
    return (thrown as Response).status;
  }
  return null;
};

describe("isJobBoardEligible", () => {
  it("is true only for a pending order with no shop", () => {
    expect(isJobBoardEligible({ status: "Pending", vendorId: null })).toBe(true);
    expect(isJobBoardEligible({ status: "Pending", vendorId: 9 })).toBe(false);
    expect(isJobBoardEligible({ status: "In_Production", vendorId: null })).toBe(false);
  });
});

describe("loadOrderDetail", () => {
  it("rejects a missing number with 400 and an unknown order with 404", async () => {
    expect(await thrownStatus(load(fakeDeps(), ""))).toBe(400);
    expect(await thrownStatus(load(fakeDeps(null)))).toBe(404);
  });

  it("signs each line item's part thumbnail and drawings", async () => {
    const deps = fakeDeps();
    deps.orders.lineItems.mockResolvedValue([
      lineItem(1, { id: "p-1", thumbnailUrl: "parts/p-1/thumb.png" }),
      lineItem(2, { id: "p-2", thumbnailUrl: null }),
      lineItem(3, null),
    ]);
    deps.parts.drawingRecords.mockImplementation(async (partId?: string) =>
      partId === "p-1" ? [drawing("d-1")] : [],
    );

    const data = await load(deps);
    const [first, second, third] = data.lineItems as unknown as Array<{
      part: { thumbnailUrl: string | null; drawings: Array<{ id: string; signedUrl: string }> } | null;
    }>;

    expect(first.part?.thumbnailUrl).toBe("signed:parts/p-1/thumb.png");
    expect(first.part?.drawings).toEqual([
      expect.objectContaining({ id: "d-1", signedUrl: "signed:drawings/d-1.pdf" }),
    ]);
    expect(second.part?.thumbnailUrl).toBeNull();
    expect(second.part?.drawings).toEqual([]);
    expect(third.part).toBeNull();
    // Only the part that has a stored thumbnail is hydrated; the customer-parts
    // list is hydrated once more as a batch.
    expect(deps.parts.hydrateThumbnails).toHaveBeenCalledTimes(2);
  });

  it("lists the customer's parts only when the order has a customer", async () => {
    const without = fakeDeps(makeOrder({ customerId: null }));
    const data = await load(without);
    expect(data.parts).toEqual([]);
    expect(data.customer).toBeNull();
    expect(without.parts.forCustomer).not.toHaveBeenCalled();

    const withCustomer = fakeDeps();
    withCustomer.parts.forCustomer.mockResolvedValue([{ id: "p-9", thumbnailUrl: "k" }]);
    expect((await load(withCustomer)).parts).toEqual([
      { id: "p-9", thumbnailUrl: "signed:k" },
    ]);
    expect(withCustomer.parts.forCustomer).toHaveBeenCalledWith(3);
  });

  it("loads job-board input only for a pending order with no shop", async () => {
    const eligible = fakeDeps(makeOrder({ status: "Pending", vendorId: null }));
    const data = await load(eligible);
    expect(data.jobBoardOrderInput).toEqual({ orderNumber: "26Z00012" });
    expect(data.jobBoardWebhookConfigured).toBe(true);
    expect(data.jobBoardNotifyRoleId).toBe("role-1");

    const assigned = fakeDeps(makeOrder({ status: "Pending", vendorId: 9 }));
    expect((await load(assigned)).jobBoardOrderInput).toBeNull();
    expect(assigned.jobBoard.orderInput).not.toHaveBeenCalled();
  });

  it("leaves the confirmation composer unloaded while outbound email is off", async () => {
    const deps = fakeDeps();
    const data = await load(deps);
    expect(data.orderConfirmationEmailReady).toBe(false);
    expect(data.orderConfirmationEmailDefaultSubject).toBeNull();
    expect(data.orderConfirmationSendBlocked).toBe(false);
    expect(deps.email.actorMerge).not.toHaveBeenCalled();
    expect(deps.email.confirmationSendBlocked).not.toHaveBeenCalled();
  });

  it("prepares the confirmation composer and its send block when email is on", async () => {
    const deps = fakeDeps(makeOrder({ totalPrice: "1234.50" }));
    deps.flags.outboundEmail.mockResolvedValue(true);
    deps.email.confirmationSendBlocked.mockResolvedValue(true);
    const data = await load(deps);
    expect(data.orderConfirmationEmailReady).toBe(true);
    expect(data.orderConfirmationEmailDefaultSubject).toMatch(
      /^Order 26Z00012 for Acme: .*1,234\.50$/,
    );
    expect(data.orderConfirmationSendBlocked).toBe(true);
    expect(deps.email.confirmationSendBlocked).toHaveBeenCalledWith("12");
  });

  it("reads the source quote's payment link only for a converted order", async () => {
    const direct = fakeDeps(makeOrder({ sourceQuoteId: null }));
    const none = await load(direct);
    expect(none.sourceQuote).toBeNull();
    expect(none.quoteStripePaymentLinkId).toBeNull();
    expect(direct.orders.sourceQuote).not.toHaveBeenCalled();

    const converted = fakeDeps(makeOrder({ sourceQuoteId: 7 }));
    const data = await load(converted);
    expect(data.sourceQuote).toEqual({ id: 7, quoteNumber: "25Q00007" });
    expect(data.quoteStripePaymentLinkId).toBe("plink_1");

    const deleted = fakeDeps(makeOrder({ sourceQuoteId: 7 }));
    deleted.orders.sourceQuote.mockResolvedValue(null);
    const gone = await load(deleted);
    expect(gone.sourceQuote).toBeNull();
    expect(gone.quoteStripePaymentLinkId).toBeNull();
  });

  it("signs the banana model only when the flag is on and its mesh is converted", async () => {
    const off = fakeDeps();
    expect((await load(off)).bananaModelUrl).toBeNull();
    expect(off.bananaModel).not.toHaveBeenCalled();

    const ready = fakeDeps();
    ready.flags.bananaForScale.mockResolvedValue(true);
    expect((await load(ready)).bananaModelUrl).toBe("signed:banana/mesh.glb");

    const converting = fakeDeps();
    converting.flags.bananaForScale.mockResolvedValue(true);
    converting.bananaModel.mockResolvedValue({
      cadUrl: null,
      meshUrl: "banana/mesh.glb",
      conversionStatus: "in_progress",
    });
    expect((await load(converting)).bananaModelUrl).toBeNull();
  });

  it("serializes archived line items for the restore list", async () => {
    const deps = fakeDeps();
    deps.orders.archivedLineItems.mockResolvedValue([
      {
        id: 4,
        name: "Bracket",
        quantity: 2,
        archivedAt: new Date("2026-03-01T00:00:00Z"),
        hardDeleteAt: new Date("2026-03-31T00:00:00Z"),
        partId: "p-1",
      },
    ] as never);
    expect((await load(deps)).archivedLineItems).toEqual([
      {
        id: 4,
        name: "Bracket",
        quantity: 2,
        archivedAt: "2026-03-01T00:00:00.000Z",
        hardDeleteAt: "2026-03-31T00:00:00.000Z",
        partId: "p-1",
      },
    ]);
  });
});
