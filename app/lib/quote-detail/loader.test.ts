import { describe, expect, it, vi } from "vitest";
import { loadQuoteDetail, type QuoteLoaderDeps } from "./loader";
import type { PartViewPorts } from "./part-view";
import { makeQuote, testAuth } from "./test-support";

const partPorts = (): PartViewPorts => ({
  preview: () => ({ cadKey: null, meshKey: null, effectiveConversionStatus: "pending" }),
  usesPlaceholderCad: () => false,
  meshUrl: vi.fn(async () => ({ error: "no mesh" })),
  sign: vi.fn(async (key: string) => `signed:${key}`),
  extractKey: (value) => value,
  drawingRecords: vi.fn(async () => []),
});

/** Every port a `vi.fn` with a harmless default; `over.quote` shapes the loaded Quote. */
function fakeDeps(quote: ReturnType<typeof makeQuote> | null = makeQuote()) {
  const deps = {
    quotes: {
      get: vi.fn(async () => quote),
      attachments: vi.fn(async () => []),
      priceCalculations: vi.fn(async () => []),
      archivedLineItems: vi.fn(async () => []),
      archiveRetentionDays: vi.fn(async () => 30),
      convertedOrder: vi.fn(async () => ({ id: 77, orderNumber: "26Z00077" })),
    },
    directory: {
      customer: vi.fn(async () => ({ id: 3, displayName: "Acme" })),
      vendor: vi.fn(async () => ({ id: 9, displayName: "Shop" })),
      customers: vi.fn(async () => []),
      vendors: vi.fn(async () => []),
    },
    notes: vi.fn(async () => []),
    events: vi.fn(async () => []),
    flags: {
      priceCalculator: vi.fn(async () => false),
      cadRevision: vi.fn(async () => false),
      pdfAutoDownload: vi.fn(async () => false),
      rejectionReasonRequired: vi.fn(async () => false),
      bananaForScale: vi.fn(async () => false),
      stripePaymentLinks: vi.fn(async () => false),
      outboundEmail: vi.fn(async () => false),
      hideLineItemThumbnails: vi.fn(async () => false),
    },
    partViewPorts: vi.fn(async () => partPorts()),
    banana: {
      model: vi.fn(async () => ({
        cadUrl: null,
        meshUrl: "banana/mesh.glb",
        conversionStatus: "completed",
      })),
      sign: vi.fn(async (key: string) => `signed:${key}`),
    },
    email: {
      composer: {
        resolveTemplate: vi.fn(async () => ({
          layoutSlug: "quote",
          template: { subjectTemplate: "Quote {{quoteNumber}} for {{customerName}}" },
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
      receivedReadiness: vi.fn(async () => ({ contextKey: null })),
      lastReceivedSend: vi.fn(async () => null),
    },
  };
  return deps as typeof deps & QuoteLoaderDeps;
}

const load = (deps: QuoteLoaderDeps, quoteId: string | undefined = "5") =>
  loadQuoteDetail({ quoteId, ...testAuth }, deps);

const thrownStatus = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (thrown) {
    return (thrown as Response).status;
  }
  return null;
};

describe("loadQuoteDetail", () => {
  it("rejects a missing id with 400 and an unknown quote with 404", async () => {
    expect(await thrownStatus(load(fakeDeps(), ""))).toBe(400);
    expect(await thrownStatus(load(fakeDeps(null)))).toBe(404);
  });

  it("looks the quote up by its numeric id", async () => {
    const deps = fakeDeps();
    await load(deps, "5");
    expect(deps.quotes.get).toHaveBeenCalledWith(5);
  });

  it("loads the customer and vendor only when the quote has them", async () => {
    const without = fakeDeps(makeQuote({ customerId: null as never, vendorId: null }));
    const data = await load(without);
    expect(data.customer).toBeNull();
    expect(data.vendor).toBeNull();
    expect(without.directory.customer).not.toHaveBeenCalled();
    expect(without.directory.vendor).not.toHaveBeenCalled();

    const withBoth = fakeDeps(makeQuote({ customerId: 3, vendorId: 9 }));
    await load(withBoth);
    expect(withBoth.directory.customer).toHaveBeenCalledWith(3);
    expect(withBoth.directory.vendor).toHaveBeenCalledWith(9);
  });

  it("returns each part with its signed view fields", async () => {
    const deps = fakeDeps(
      makeQuote({
        parts: [
          {
            id: "qp-1",
            specifications: null,
            partFileUrl: "quote-parts/qp-1/a.step",
            partMeshUrl: null,
            conversionStatus: "pending",
            thumbnailUrl: null,
          },
        ] as never,
      }),
    );
    const data = await load(deps);
    expect(data.quote.parts).toHaveLength(1);
    expect(data.quote.parts[0]).toMatchObject({
      id: "qp-1",
      signedFileUrl: "signed:quote-parts/qp-1/a.step",
      drawings: [],
      usesPlaceholderCad: false,
    });
    expect(deps.partViewPorts).toHaveBeenCalledTimes(1);
  });

  it("leaves the send composer unloaded while outbound email is off", async () => {
    const deps = fakeDeps();
    const data = await load(deps);
    expect(data.outboundEmailEnabled).toBe(false);
    expect(data.quoteSendEmailReady).toBe(false);
    expect(data.quoteSendEmailDefaultSubject).toBeNull();
    expect(data.quoteSendEditableSlots).toEqual([]);
    expect(deps.email.actorMerge).not.toHaveBeenCalled();
    expect(deps.email.composer.resolveTemplate).not.toHaveBeenCalled();
  });

  it("prepares the send composer from the quote when outbound email is on", async () => {
    const deps = fakeDeps(makeQuote({ quoteNumber: "Q-0005", customerId: 3 }));
    deps.flags.outboundEmail.mockResolvedValue(true);
    const data = await load(deps);
    expect(data.quoteSendEmailReady).toBe(true);
    expect(data.quoteSendEmailDefaultSubject).toBe("Quote Q-0005 for Acme");
    expect(deps.email.actorMerge).toHaveBeenCalledWith({
      email: testAuth.userDetails.email,
      name: testAuth.userDetails.name,
    });
  });

  it("signs the banana model only when the flag is on and its mesh is converted", async () => {
    const off = fakeDeps();
    expect((await load(off)).bananaModelUrl).toBeNull();
    expect(off.banana.model).not.toHaveBeenCalled();

    const converting = fakeDeps();
    converting.flags.bananaForScale.mockResolvedValue(true);
    converting.banana.model.mockResolvedValue({
      cadUrl: null,
      meshUrl: "banana/mesh.glb",
      conversionStatus: "in_progress",
    });
    expect((await load(converting)).bananaModelUrl).toBeNull();
    expect(converting.banana.sign).not.toHaveBeenCalled();

    const ready = fakeDeps();
    ready.flags.bananaForScale.mockResolvedValue(true);
    expect((await load(ready)).bananaModelUrl).toBe("signed:banana/mesh.glb");
  });

  it("loads the converted order only for a converted quote", async () => {
    const open = fakeDeps(makeQuote({ convertedToOrderId: null }));
    expect((await load(open)).convertedOrder).toBeNull();
    expect(open.quotes.convertedOrder).not.toHaveBeenCalled();

    const converted = fakeDeps(makeQuote({ convertedToOrderId: 77 }));
    expect((await load(converted)).convertedOrder).toMatchObject({ orderNumber: "26Z00077" });
    expect(converted.quotes.convertedOrder).toHaveBeenCalledWith(77);
  });

  it("serializes archived line items for the restore list", async () => {
    const deps = fakeDeps();
    deps.quotes.archivedLineItems.mockResolvedValue([
      {
        id: 4,
        name: "Bracket",
        quantity: 2,
        archivedAt: new Date("2026-03-01T00:00:00Z"),
        hardDeleteAt: new Date("2026-03-31T00:00:00Z"),
        quotePartId: "qp-1",
        internalOnly: "dropped",
      },
    ] as never);
    const data = await load(deps);
    expect(data.archivedLineItems).toEqual([
      {
        id: 4,
        name: "Bracket",
        quantity: 2,
        archivedAt: "2026-03-01T00:00:00.000Z",
        hardDeleteAt: "2026-03-31T00:00:00.000Z",
        quotePartId: "qp-1",
      },
    ]);
    expect(data.archiveRetentionDays).toBe(30);
  });

  it("reports the last quote-received send only when a context is configured", async () => {
    const none = fakeDeps();
    expect((await load(none)).quoteReceivedLastSend).toBeNull();
    expect(none.email.lastReceivedSend).not.toHaveBeenCalled();

    const sent = fakeDeps();
    sent.email.receivedReadiness.mockResolvedValue({ contextKey: "quote_received" } as never);
    sent.email.lastReceivedSend.mockResolvedValue({
      createdAt: new Date("2026-04-01T10:00:00Z"),
      sentAt: null,
      toAddresses: ["buyer@example.com", "cc@example.com"],
      status: "queued",
    } as never);
    const data = await load(sent);
    expect(sent.email.lastReceivedSend).toHaveBeenCalledWith(7, "quote_received");
    expect(data.quoteReceivedLastSend).toEqual({
      createdAt: "2026-04-01T10:00:00.000Z",
      sentAt: null,
      to: "buyer@example.com",
      status: "queued",
    });
  });

  it("passes the signed-in user's role to the role-gated flags", async () => {
    const deps = fakeDeps();
    deps.flags.priceCalculator.mockResolvedValue(true);
    const data = await load(deps);
    expect(deps.flags.priceCalculator).toHaveBeenCalledWith(testAuth.userDetails.role);
    expect(deps.flags.cadRevision).toHaveBeenCalledWith(testAuth.userDetails.role);
    expect(data.canAccessPriceCalculator).toBe(true);
    expect(data.canRevise).toBe(false);
  });
});
