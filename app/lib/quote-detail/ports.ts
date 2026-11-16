/**
 * The Quote detail action's seam.
 *
 * Intent handlers (see `./intents/*`) decide what should happen: validation,
 * status policy, ordering of side effects. Everything that touches Postgres,
 * S3, Stripe, the queue or the clock goes through these ports.
 *
 *   production adapter: `./deps.server.ts`
 *   test adapter:       `./test-support.ts`
 *
 * Two adapters per port is what justifies the seam.
 */
import type { QuoteInput } from "~/lib/quotes";
import type { EventsPort, FilesPort } from "~/lib/route-actions/ports";
import type { Actor } from "~/lib/route-actions/core";
import type { DocumentGenerationDeps } from "~/lib/route-actions/entity-documents";
import type { DrawingUploadPorts } from "~/lib/route-actions/drawing-uploads";
import type { NotesPort } from "~/lib/route-actions/note-intents";
import type {
  handleEmailPreviewAction,
  handleEmailQueueAction,
} from "~/lib/email/outbound-email-route-actions.server";
import type { enqueueQuoteReceivedUserEmail } from "~/lib/email/enqueue-quote-received-email.server";
import type { AttachmentDocumentKind } from "~/lib/db/schema";

export type { Actor, EventsPort, FilesPort };

export type ConversionResult = {
  success: boolean;
  orderNumber?: string;
  error?: string;
};

export type QuotesPort = {
  update(id: number, updates: Partial<QuoteInput>, actor: Actor): Promise<unknown>;
  archive(id: number, actor: Actor): Promise<unknown>;
  restore(id: number, actor: Actor): Promise<unknown>;
  convertToOrder(
    id: number,
    actor: Actor,
    options?: {
      poNumber?: string | null;
      viaCustomerPo?: boolean;
      customerPoAttachmentId?: string;
    },
  ): Promise<ConversionResult>;
  duplicate(
    id: number,
    actor: Actor,
  ): Promise<{ success: boolean; quoteId?: number; quoteNumber?: string; error?: string }>;
  transitionToSent(
    id: number,
    actor: Actor,
  ): Promise<{ success: boolean; error?: string }>;
  /** Revision: back to Draft and forget the Stripe payment link. */
  resetToDraftForRevision(id: number): Promise<void>;
  recalculateTotals(id: number): Promise<unknown>;
  savePriceCalculation(
    data: Record<string, unknown>,
    userId: string | undefined,
  ): Promise<unknown>;
};

export type QuoteLineRow = {
  id: number;
  quoteId: number;
  quotePartId: string | null;
  quantity: number;
  unitPrice: string | null;
  totalPrice: string | null;
};

export type QuoteLineItemsPort = {
  find(id: number): Promise<QuoteLineRow | null>;
  /** Lines used as the base for "% off" entries. */
  list(quoteId: number, scope: "active" | "all"): Promise<QuoteLineRow[]>;
  create(
    quoteId: number,
    data: {
      quotePartId?: string;
      name?: string;
      quantity: number;
      unitPrice: number;
      description?: string;
      notes?: string;
    },
    actor: Actor,
  ): Promise<unknown>;
  update(
    id: number,
    data: Partial<{
      quantity: number;
      unitPrice: number;
      description: string;
      notes: string;
      name: string;
    }>,
    actor: Actor,
  ): Promise<unknown>;
  /** Attach a freshly created QuotePart to an existing standalone line. */
  linkToPart(
    id: number,
    patch: {
      quotePartId: string | null;
      name: string | null;
      description: string | null;
      notes: string | null;
      quantity: number;
      unitPrice: string;
      totalPrice: string;
    },
  ): Promise<void>;
  archive(id: number, quoteId: number, actor: Actor): Promise<unknown>;
  restore(id: number, quoteId: number, actor: Actor): Promise<unknown>;
};

export type QuotePartRow = {
  id: string;
  partName: string | null;
  partFileUrl: string | null;
  specifications: unknown;
  material: string | null;
  tolerance: string | null;
  finish: string | null;
};

export type QuotePartsPort = {
  find(id: string): Promise<QuotePartRow | null>;
  createFromCad(input: {
    quoteId: number;
    partNumber: string;
    partName: string;
    description: string | null;
    material: string | null;
    tolerance: string | null;
    finish: string | null;
    partFileUrl: string;
  }): Promise<{ id: string; partName: string | null }>;
  createDrawingOnly(input: {
    quoteId: number;
    partNumber: string;
    partName: string;
    description: string | null;
    material: string | null;
    tolerance: string | null;
    finish: string | null;
  }): Promise<{ id: string }>;
  /** Make a drawing-only part viewable (placeholder CAD/mesh from the primary drawing). */
  ensureDrawingOnlyAssets(
    quotePartId: string,
    primary: { buffer: Buffer; fileName: string },
  ): Promise<void>;
  updateAttributes(
    id: string,
    attrs: { material: string | null; tolerance: string | null; finish: string | null },
  ): Promise<void>;
  /** True when the preview CAD/mesh comes from the Settings placeholder, not an upload. */
  usesPlaceholderCad(specifications: unknown): boolean;
  resetMeshConversion(id: string): Promise<void>;
  /** Start async CAD to mesh conversion. Rejects when it could not be started. */
  startMeshConversion(id: string, sourceKey: string): Promise<void>;
  /** Link a stored drawing attachment to a QuotePart. */
  linkDrawing(quotePartId: string, attachmentId: string): Promise<void>;
  /** Remove every QuotePart link that points at this drawing attachment. */
  unlinkDrawing(attachmentId: string): Promise<void>;
};

export type StoredAttachment = {
  id: string;
  s3Key: string;
  isProtected?: boolean | null;
};

export type AttachmentsPort = {
  get(id: string): Promise<StoredAttachment | null>;
  create(
    data: {
      s3Bucket: string;
      s3Key: string;
      fileName: string;
      contentType: string;
      fileSize: number;
      source: "user_upload";
      documentKind?: AttachmentDocumentKind;
    },
    actor: Actor,
  ): Promise<{ id: string }>;
  delete(
    id: string,
    actor: Actor & { canDeleteProtected?: boolean },
  ): Promise<void>;
  /** The attachment, only when it belongs to this Quote. */
  findOnQuote(
    attachmentId: string,
    quoteId: number,
    canDeleteProtected: boolean,
  ): Promise<StoredAttachment | null>;
  linkToQuote(quoteId: number, attachmentId: string): Promise<void>;
  unlinkFromQuote(quoteId: number, attachmentId: string): Promise<void>;
};

export type StripePort = {
  enabled(): Promise<boolean>;
  deactivatePaymentLink(paymentLinkId: string): Promise<void>;
};

export type EmailPort = {
  outboundEnabled(): Promise<boolean>;
  preview(
    args: Parameters<typeof handleEmailPreviewAction>[0],
  ): ReturnType<typeof handleEmailPreviewAction>;
  queue(
    args: Parameters<typeof handleEmailQueueAction>[0],
  ): ReturnType<typeof handleEmailQueueAction>;
  enqueueQuoteReceived(
    args: Parameters<typeof enqueueQuoteReceivedUserEmail>[0],
  ): ReturnType<typeof enqueueQuoteReceivedUserEmail>;
};

export type ClockPort = {
  /** Start of today in the app's business timezone. */
  today(): Date;
};

export type IdsPort = {
  /** `QP-<ms>-<8 hex>` */
  quotePartNumber(): string;
  uuid(): string;
};

export type QuoteDeps = {
  quotes: QuotesPort;
  lineItems: QuoteLineItemsPort;
  parts: QuotePartsPort;
  attachments: AttachmentsPort;
  files: FilesPort;
  events: EventsPort;
  stripe: StripePort;
  email: EmailPort;
  clock: ClockPort;
  ids: IdsPort;
  /** Drawing upload adapters (storage + thumbnails + attachment records). */
  drawingUploads: DrawingUploadPorts;
  documents: DocumentGenerationDeps;
  notes: NotesPort;
};
