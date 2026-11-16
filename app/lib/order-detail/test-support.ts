/**
 * Test adapter for the Order detail seam: every port is a `vi.fn` with a
 * harmless default. Not imported by app code.
 */
import { vi } from "vitest";
import { dispatchIntent, type IntentTable } from "~/lib/route-actions/core";
import type { OrderAuth, OrderCtx, OrderEntity } from "./context";
import type { OrderDeps } from "./ports";

export function makeOrder(over: Partial<OrderEntity> = {}): OrderEntity {
  return {
    id: 12,
    orderNumber: "26Z00012",
    customerId: 3,
    vendorId: null,
    sourceQuoteId: null,
    status: "Pending",
    totalPrice: "100.00",
    ndaRequired: false,
    deliveryDate: null,
    leadTime: null,
    vendorPay: null,
    poNumber: null,
    createdAt: new Date("2026-01-02T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    attachments: [],
    ...over,
  } as unknown as OrderEntity;
}

export const testAuth = {
  user: { id: "u1", email: "ops@example.com" },
  userDetails: { id: "u1", email: "ops@example.com", name: "Ops", role: "User" },
} as unknown as OrderAuth;

export function fakeOrderDeps(): OrderDeps {
  return {
    orders: {
      update: vi.fn(async () => ({})),
      restore: vi.fn(async () => {}),
      duplicate: vi.fn(async () => ({ success: true, orderNumber: "26Z00013" })),
    },
    lineItems: {
      find: vi.fn(async () => null),
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 1 })),
      update: vi.fn(async () => ({ id: 1 })),
      archive: vi.fn(async () => ({})),
      restore: vi.fn(async () => ({})),
    },
    parts: {
      find: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "part-1" })),
      updateAttributes: vi.fn(async () => {}),
      resetMeshConversion: vi.fn(async () => {}),
      startMeshConversion: vi.fn(async () => {}),
      linkDrawing: vi.fn(async () => {}),
      unlinkDrawing: vi.fn(async () => {}),
    },
    attachments: {
      get: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "att-1" })),
      delete: vi.fn(async () => {}),
      removeRecord: vi.fn(async () => {}),
      findOnOrder: vi.fn(async () => null),
      linkToOrder: vi.fn(async () => {}),
      unlinkFromOrder: vi.fn(async () => {}),
    },
    tracking: {
      add: vi.fn(async () => ({})),
      remove: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      willHaveAfterChanges: vi.fn(async () => true),
    },
    jobBoard: {
      settings: vi.fn(async () => ({ webhookUrl: "https://discord.test/hook" })),
      assertEligible: vi.fn(async () => ({ ok: true as const })),
      assertEligibleForPost: vi.fn(async () => ({ ok: true as const })),
      loadOrderInput: vi.fn(async () => ({ orderNumber: "26Z00012" }) as never),
      sendPost: vi.fn(async () => ({ ok: true as const, sentMessages: [] })) as never,
      markAsSent: vi.fn(async () => {}),
      updateClaim: vi.fn(async () => ({ ok: true as const })),
    },
    checkoutAddresses: {
      importQuick: vi.fn(async () => ({ status: "imported" })),
      applyChoices: vi.fn(async () => ({ ok: true as const, updated: ["billing"] })),
    },
    email: {
      preview: vi.fn(async () => new Response(JSON.stringify({ preview: true }))),
      queue: vi.fn(async () => new Response(JSON.stringify({ queued: true }))),
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
      keyFor: vi.fn((id: number, name: string) => `orders/${id}/${name}`),
    },
    events: { create: vi.fn(async () => ({})) },
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
      findAttachmentKey: vi.fn(async () => "orders/12/doc.pdf"),
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

export function makeOrderCtx(
  over: { order?: Partial<OrderEntity>; deps?: OrderDeps; auth?: OrderAuth } = {},
): OrderCtx {
  const order = makeOrder(over.order);
  return {
    order,
    actor: { userId: "u1", userEmail: "ops@example.com" },
    auth: over.auth ?? testAuth,
    entityRef: { type: "order", id: String(order.id) },
    deps: over.deps ?? fakeOrderDeps(),
  };
}

/** A real File that reports `bytes` as its size without allocating that much. */
export function oversizedFile(name = "big.pdf", bytes = 11 * 1024 * 1024): File {
  const f = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

export function runIntent(
  table: IntentTable<OrderCtx>,
  ctx: OrderCtx,
  intent: string,
  fields: Record<string, string | Blob> = {},
): Promise<Response> {
  const formData = new FormData();
  for (const [k, v] of Object.entries(fields)) formData.set(k, v);
  return dispatchIntent({
    table,
    intent,
    ctx,
    formData,
    messages: { unknownIntent: "Invalid intent", failure: "Failed to process request" },
  });
}

export const locationOf = (res: Response) => res.headers.get("Location");
