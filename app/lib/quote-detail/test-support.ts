/**
 * Test adapter for the Quote detail seam: every port is a `vi.fn` with a
 * harmless default, so a test overrides only what it cares about.
 * Not imported by app code.
 */
import { vi } from "vitest";
import type { QuoteAuth, QuoteCtx, QuoteEntity } from "./context";
import type { QuoteDeps } from "./ports";
import { dispatchIntent, type IntentTable } from "~/lib/route-actions/core";

export function makeQuote(over: Partial<QuoteEntity> = {}): QuoteEntity {
  return {
    id: 7,
    quoteNumber: "25Q00007",
    customerId: 1,
    vendorId: null,
    status: "Draft",
    validUntil: null,
    expirationDays: 30,
    sentAt: null,
    acceptedAt: null,
    expiredAt: null,
    archivedAt: null,
    subtotal: "100.00",
    total: "100.00",
    createdById: null,
    convertedToOrderId: null,
    rejectionReason: null,
    stripePaymentLinkUrl: null,
    stripePaymentLinkId: null,
    stripePaymentLinkActive: null,
    estimatedDeliveryDateStart: null,
    estimatedDeliveryDateEnd: null,
    leadTimeBusinessDaysMin: null,
    leadTimeBusinessDaysMax: null,
    ndaRequired: false,
    isArchived: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    lineItems: [],
    parts: [],
    ...over,
  } as QuoteEntity;
}

export const testAuth = {
  user: { id: "u1", email: "ops@example.com" },
  userDetails: { id: "u1", email: "ops@example.com", name: "Ops", role: "User" },
} as unknown as QuoteAuth;

export function fakeQuoteDeps(): QuoteDeps {
  return {
    quotes: {
      update: vi.fn(async () => ({})),
      archive: vi.fn(async () => true),
      restore: vi.fn(async () => true),
      convertToOrder: vi.fn(async () => ({ success: true, orderNumber: "25Z00001" })),
      duplicate: vi.fn(async () => ({ success: true, quoteId: 8, quoteNumber: "25Q00008" })),
      transitionToSent: vi.fn(async () => ({ success: true })),
      resetToDraftForRevision: vi.fn(async () => {}),
      recalculateTotals: vi.fn(async () => ({ subtotal: 0, total: 0 })),
      savePriceCalculation: vi.fn(async () => ({})),
    },
    lineItems: {
      find: vi.fn(async () => null),
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      linkToPart: vi.fn(async () => {}),
      archive: vi.fn(async () => ({})),
      restore: vi.fn(async () => ({})),
    },
    parts: {
      find: vi.fn(async () => null),
      createFromCad: vi.fn(async () => ({ id: "qp-1", partName: "Part" })),
      createDrawingOnly: vi.fn(async () => ({ id: "qp-1" })),
      ensureDrawingOnlyAssets: vi.fn(async () => {}),
      updateAttributes: vi.fn(async () => {}),
      usesPlaceholderCad: vi.fn(() => false),
      resetMeshConversion: vi.fn(async () => {}),
      startMeshConversion: vi.fn(async () => {}),
      linkDrawing: vi.fn(async () => {}),
      unlinkDrawing: vi.fn(async () => {}),
    },
    attachments: {
      get: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "att-1" })),
      delete: vi.fn(async () => {}),
      findOnQuote: vi.fn(async () => null),
      linkToQuote: vi.fn(async () => {}),
      unlinkFromQuote: vi.fn(async () => {}),
    },
    files: {
      upload: vi.fn(async ({ key, fileName, contentType, buffer }) => ({
        key,
        bucket: "bucket",
        fileName,
        contentType,
        size: buffer.byteLength,
      })),
      delete: vi.fn(async () => {}),
      signedUrl: vi.fn(async (key: string) => `https://signed.test/${key}`),
      keyFor: vi.fn((id: number, name: string) => `quotes/${id}/${name}`),
    },
    events: { create: vi.fn(async () => ({})) },
    stripe: {
      enabled: vi.fn(async () => false),
      deactivatePaymentLink: vi.fn(async () => {}),
    },
    email: {
      outboundEnabled: vi.fn(async () => true),
      preview: vi.fn(async () => new Response(JSON.stringify({ preview: true }))),
      queue: vi.fn(async () => new Response(JSON.stringify({ queued: true }))),
      enqueueQuoteReceived: vi.fn(async () => ({ ok: true, delivery: "queued" })) as never,
    },
    clock: { today: vi.fn(() => new Date("2026-03-02T00:00:00")) },
    ids: {
      quotePartNumber: vi.fn(() => "QP-TEST-0001"),
      uuid: vi.fn(() => "uuid-1"),
    },
    drawingUploads: {
      storage: { upload: vi.fn(async ({ key }) => ({ key })) },
      thumbnails: {
        fromPdf: vi.fn(async () => Buffer.from("png")),
        isPdf: vi.fn((type: string, name: string) => type === "application/pdf" || name.endsWith(".pdf")),
      },
      attachments: { create: vi.fn(async () => ({ id: "drawing-att-1" })) },
    },
    documents: {
      generateDocumentPdf: vi.fn(async () => ({ attachmentId: "doc-1" })),
      findAttachmentKey: vi.fn(async () => "quotes/7/doc.pdf"),
      signDownloadUrl: vi.fn(async (key: string) => `https://signed.test/${key}`),
    },
    notes: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      archive: vi.fn(async () => ({})),
    },
  };
}

export function makeQuoteCtx(
  over: { quote?: Partial<QuoteEntity>; deps?: QuoteDeps; auth?: QuoteAuth } = {},
): QuoteCtx {
  const quote = makeQuote(over.quote);
  return {
    quote,
    actor: { userId: "u1", userEmail: "ops@example.com" },
    auth: over.auth ?? testAuth,
    entityRef: { type: "quote", id: String(quote.id) },
    deps: over.deps ?? fakeQuoteDeps(),
  };
}

export function formOf(entries: Record<string, string | Blob>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

/** Run one intent through the real dispatcher against a table. */
export function runIntent(
  table: IntentTable<QuoteCtx>,
  ctx: QuoteCtx,
  intent: string,
  fields: Record<string, string | Blob> = {},
): Promise<Response> {
  return dispatchIntent({
    table,
    intent,
    ctx,
    formData: formOf(fields),
    messages: { unknownIntent: "Invalid action", failure: "An error occurred" },
  });
}

/** A real File that reports `bytes` as its size without allocating that much. */
export function oversizedFile(name = "big.pdf", bytes = 11 * 1024 * 1024): File {
  const f = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

export const locationOf = (res: Response) => res.headers.get("Location");
