/**
 * The Order detail action's seam. See `app/lib/quote-detail/ports.ts` for the
 * rationale; this is its Order counterpart.
 *
 *   production adapter: `./deps.server.ts`
 *   test adapter:       `./test-support.ts`
 */
import type { OrderInput } from "~/lib/orders";
import type {
  handleEmailPreviewAction,
  handleEmailQueueAction,
} from "~/lib/email/outbound-email-route-actions.server";
import type {
  JobBoardOrderInput,
  JobBoardSentMessageRecord,
} from "~/lib/job-board/types";
import type { JobBoardSendProgress } from "~/lib/job-board/sender.server";
import type { TrackingEntry, TrackingNumberUpdate } from "~/lib/order-tracking";
import type { DocumentGenerationDeps } from "~/lib/route-actions/entity-documents";
import type { DrawingUploadPorts } from "~/lib/route-actions/drawing-uploads";
import type { NotesPort } from "~/lib/route-actions/note-intents";
import type { Actor } from "~/lib/route-actions/core";
import type { EventsPort, FilesPort } from "~/lib/route-actions/ports";

export type { Actor, EventsPort, FilesPort };

export type OrdersPort = {
  update(id: number, updates: Partial<OrderInput>, actor: Actor): Promise<unknown>;
  restore(id: number, actor: Actor): Promise<void>;
  duplicate(
    id: number,
    actor: Actor,
  ): Promise<{ success: boolean; orderNumber?: string; error?: string }>;
};

export type OrderLineRow = {
  id: number;
  orderId: number;
  partId: string | null;
  quantity: number;
  unitPrice: string | null;
};

export type OrderLineItemsPort = {
  find(id: number): Promise<OrderLineRow | null>;
  list(orderId: number): Promise<OrderLineRow[]>;
  create(
    data: {
      orderId: number;
      name: string;
      description: string;
      quantity: number;
      unitPrice: string;
      partId: string | null;
      notes: string | null;
    },
    actor: Actor,
  ): Promise<unknown>;
  update(
    id: number,
    data: Partial<{
      name: string;
      description: string;
      quantity: number;
      unitPrice: string;
      partId: string | null;
      notes: string | null;
    }>,
    actor: Actor,
  ): Promise<unknown>;
  archive(id: number, orderId: number, actor: Actor): Promise<unknown>;
  restore(id: number, orderId: number, actor: Actor): Promise<unknown>;
};

export type PartRow = {
  id: string;
  partName: string | null;
  partFileUrl: string | null;
  material: string | null;
  tolerance: string | null;
  finishing: string | null;
};

export type OrderPartsPort = {
  find(id: string): Promise<PartRow | null>;
  create(
    data: {
      customerId: number;
      partName: string;
      notes: string | null;
      material: string | null;
      tolerance: string | null;
      finishing: string | null;
      partFileUrl: string;
    },
    actor: Actor,
  ): Promise<{ id: string }>;
  updateAttributes(
    id: string,
    attrs: { material: string | null; tolerance: string | null; finishing: string | null },
  ): Promise<void>;
  resetMeshConversion(id: string): Promise<void>;
  /** Start async CAD to mesh conversion. Rejects when it could not be started. */
  startMeshConversion(id: string, sourceKey: string): Promise<void>;
  linkDrawing(partId: string, attachmentId: string): Promise<void>;
  /** Remove every Part link that points at this drawing attachment. */
  unlinkDrawing(attachmentId: string): Promise<void>;
};

export type StoredAttachment = {
  id: string;
  s3Key: string;
  thumbnailS3Key?: string | null;
  fileName?: string;
  isProtected?: boolean | null;
};

export type OrderAttachmentsPort = {
  get(id: string): Promise<StoredAttachment | null>;
  create(
    data: {
      s3Bucket: string;
      s3Key: string;
      fileName: string;
      contentType: string;
      fileSize: number;
      source: "user_upload";
    },
    actor: Actor,
  ): Promise<{ id: string }>;
  delete(id: string, actor: Actor & { canDeleteProtected?: boolean }): Promise<void>;
  /** Delete only the attachment row (drawings clean up their own files). */
  removeRecord(id: string): Promise<void>;
  /** The attachment, only when it belongs to this Order. */
  findOnOrder(
    attachmentId: string,
    orderId: number,
    actor: Actor & { canDeleteProtected: boolean },
  ): Promise<StoredAttachment | null>;
  linkToOrder(orderId: number, attachmentId: string, actor: Actor): Promise<void>;
  unlinkFromOrder(
    orderId: number,
    attachmentId: string,
    actor: Actor & { canDeleteProtected?: boolean },
  ): Promise<void>;
};

export type TrackingPort = {
  add(orderId: number, entries: TrackingEntry[], actor: Actor): Promise<unknown>;
  remove(orderId: number, ids: number[], actor: Actor): Promise<unknown>;
  update(orderId: number, updates: TrackingNumberUpdate[], actor: Actor): Promise<unknown>;
  willHaveAfterChanges(
    orderId: number,
    deletedIds: number[],
    updates: TrackingNumberUpdate[],
    added: TrackingEntry[],
  ): Promise<boolean>;
};

export type JobBoardPort = {
  settings(): Promise<{ webhookUrl: string | null }>;
  assertEligible(orderId: number): Promise<{ ok: true } | { ok: false; error: string }>;
  assertEligibleForPost(orderId: number): Promise<{ ok: true } | { ok: false; error: string }>;
  loadOrderInput(orderId: number): Promise<JobBoardOrderInput | null>;
  sendPost(params: {
    orderId: number;
    orderInput: JobBoardOrderInput;
    webhookUrl: string;
    postText: string;
    selectedAttachmentIds: string[];
    startAtMessageIndex: number;
    priorSentMessages: JobBoardSentMessageRecord[];
    actor: Actor;
  }): Promise<JobBoardSendProgress>;
  markAsSent(params: { orderId: number; orderNumber: string; actor: Actor }): Promise<void>;
  updateClaim(params: {
    orderId: number;
    vendorId: number;
    webhookUrl: string | null;
  }): Promise<{ ok: true } | { ok: false; warning: string }>;
};

export type CheckoutAddressesPort = {
  importQuick(params: {
    orderId: number;
    sourceQuoteId: number | null;
    customerId: number | null;
    actor: Actor;
  }): Promise<unknown>;
  applyChoices(params: {
    orderId: number;
    sourceQuoteId: number | null;
    customerId: number | null;
    billingChoice?: "checkout" | "on_file";
    shippingChoice?: "checkout" | "on_file";
    phoneChoice?: "checkout" | "on_file";
    actor: Actor;
  }): Promise<
    { ok: true; updated: unknown } | { ok: false; message: string; reason: string }
  >;
};

export type EmailPort = {
  preview(
    args: Parameters<typeof handleEmailPreviewAction>[0],
  ): ReturnType<typeof handleEmailPreviewAction>;
  queue(
    args: Parameters<typeof handleEmailQueueAction>[0],
  ): ReturnType<typeof handleEmailQueueAction>;
};

export type OrderDeps = {
  orders: OrdersPort;
  lineItems: OrderLineItemsPort;
  parts: OrderPartsPort;
  attachments: OrderAttachmentsPort;
  tracking: TrackingPort;
  jobBoard: JobBoardPort;
  checkoutAddresses: CheckoutAddressesPort;
  email: EmailPort;
  files: FilesPort;
  events: EventsPort;
  drawingUploads: DrawingUploadPorts;
  documents: DocumentGenerationDeps;
  notes: NotesPort;
};
