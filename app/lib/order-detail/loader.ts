/**
 * Everything the Order detail page needs, assembled in one place.
 *
 * `loadOrderDetail` decides what to fetch and how to shape it; every lookup goes
 * through {@link OrderLoaderDeps}, so the conditional rules (job-board
 * eligibility, composer only when outbound email is on, the source Quote's
 * payment link) are tested without Postgres or S3.
 *
 *   production adapter: `./loader.server.ts`
 *   test adapter:       `./loader.test.ts`
 *
 * Drawing URL signing lives in `~/lib/route-actions/signed-drawings.ts` and the
 * order-confirmation composer state in `~/lib/route-actions/send-composer.ts`.
 */
import type { getCustomer } from "~/lib/customers";
import { EMAIL_CONTEXT } from "~/lib/email/email-context-registry";
import { formatCurrency } from "~/lib/email/resolve/formatters";
import type { getEventsForOrder } from "~/lib/events";
import type {
  getBananaModelUrls,
  getLineItemArchiveRetentionDays,
} from "~/lib/developerSettings";
import type { getJobBoardSettings } from "~/lib/job-board/webhook-setting.server";
import type { loadJobBoardOrderInput } from "~/lib/job-board/order-data.server";
import type { listArchivedOrderLineItems } from "~/lib/line-item-archive.server";
import type { getLineItemsByOrderId } from "~/lib/lineItems";
import type { getNotes } from "~/lib/notes";
import type { getTrackingNumbersByOrderId } from "~/lib/order-tracking";
import type { getOrderByNumberWithAttachments } from "~/lib/orders";
import type { getPartsByCustomerId, hydratePartThumbnails } from "~/lib/parts";
import {
  loadSendComposer,
  type SendComposerPorts,
} from "~/lib/route-actions/send-composer";
import {
  signDrawingAttachments,
  type StoredDrawingAttachment,
} from "~/lib/route-actions/signed-drawings";
import type { getVendor, getVendors } from "~/lib/vendors";
import type { OrderAuth } from "./context";

type Role = OrderAuth["userDetails"]["role"];

export type OrderLoaderDeps = {
  orders: {
    getByNumber: typeof getOrderByNumberWithAttachments;
    lineItems: typeof getLineItemsByOrderId;
    trackingNumbers: typeof getTrackingNumbersByOrderId;
    archivedLineItems: typeof listArchivedOrderLineItems;
    archiveRetentionDays: typeof getLineItemArchiveRetentionDays;
    /** The Quote this Order was converted from, as far as the page needs it. */
    sourceQuote(
      quoteId: number,
    ): Promise<{ quoteNumber: string | null; stripePaymentLinkId: string | null } | null>;
  };
  directory: {
    customer: typeof getCustomer;
    vendor: typeof getVendor;
    vendors: typeof getVendors;
  };
  parts: {
    forCustomer: typeof getPartsByCustomerId;
    /** Replace stored thumbnail keys with signed URLs. */
    hydrateThumbnails: typeof hydratePartThumbnails;
    drawingRecords(
      partId: string,
    ): Promise<Array<{ attachment: StoredDrawingAttachment | null }>>;
  };
  notes: typeof getNotes;
  events: typeof getEventsForOrder;
  flags: {
    cadRevision(role: Role | undefined): Promise<boolean>;
    pdfAutoDownload(): Promise<boolean>;
    bananaForScale(): Promise<boolean>;
    stripePaymentLinks(): Promise<boolean>;
    stripeConfigured(): boolean;
    outboundEmail(): Promise<boolean>;
    hideLineItemThumbnails(): Promise<boolean>;
  };
  sign(key: string, expiresInSeconds?: number): Promise<string>;
  bananaModel: typeof getBananaModelUrls;
  jobBoard: {
    orderInput: typeof loadJobBoardOrderInput;
    settings: typeof getJobBoardSettings;
  };
  email: {
    composer: SendComposerPorts;
    actorMerge(source: {
      email: string;
      name: string | null | undefined;
    }): Promise<Record<string, string>>;
    /** True when an order confirmation is already queued or sent. */
    confirmationSendBlocked(orderId: string): Promise<boolean>;
  };
};

/** An Order can go on the job board only while it has no shop. */
export const isJobBoardEligible = (order: {
  status: string;
  vendorId: number | null;
}) => order.status === "Pending" && order.vendorId == null;

export async function loadOrderDetail(
  input: { orderNumber: string | undefined } & OrderAuth,
  deps: OrderLoaderDeps,
) {
  const { user, userDetails } = input;

  if (!input.orderNumber) {
    throw new Response("Order number is required", { status: 400 });
  }
  const order = await deps.orders.getByNumber(input.orderNumber);
  if (!order) {
    throw new Response("Order not found", { status: 404 });
  }

  const [customer, vendor, vendors, notes, lineItems] = await Promise.all([
    order.customerId ? deps.directory.customer(order.customerId) : null,
    order.vendorId ? deps.directory.vendor(order.vendorId) : null,
    deps.directory.vendors(),
    deps.notes("order", order.id.toString()),
    deps.orders.lineItems(order.id),
  ]);

  // Sign thumbnails and drawings for each line item's part.
  await Promise.all(
    lineItems.map(async (item) => {
      if (!item.part) return;
      if (item.part.thumbnailUrl) {
        const [hydratedPart] = await deps.parts.hydrateThumbnails([item.part]);
        item.part = hydratedPart;
      }
      const drawingRecords = await deps.parts.drawingRecords(item.part.id);
      Object.assign(item.part, {
        drawings: await signDrawingAttachments(drawingRecords, deps.sign),
      });
    }),
  );

  const [customerParts, trackingNumbers] = await Promise.all([
    order.customerId ? deps.parts.forCustomer(order.customerId) : [],
    deps.orders.trackingNumbers(order.id),
  ]);
  const parts = await deps.parts.hydrateThumbnails(customerParts);

  const [
    pdfAutoDownload,
    events,
    canRevise,
    bananaEnabled,
    outboundEmailEnabled,
    hideLineItemThumbnails,
  ] = await Promise.all([
    deps.flags.pdfAutoDownload(),
    deps.events(order.id, 10),
    deps.flags.cadRevision(userDetails?.role),
    deps.flags.bananaForScale(),
    deps.flags.outboundEmail(),
    deps.flags.hideLineItemThumbnails(),
  ]);

  let bananaModelUrl: string | null = null;
  if (bananaEnabled) {
    const banana = await deps.bananaModel();
    if (banana.meshUrl && banana.conversionStatus === "completed") {
      bananaModelUrl = await deps.sign(banana.meshUrl);
    }
  }

  let orderConfirmation = null;
  let orderConfirmationSendBlocked = false;
  if (outboundEmailEnabled) {
    const [composer, blocked] = await Promise.all([
      deps.email
        .actorMerge({
          email: userDetails?.email?.trim() || user?.email?.trim() || "",
          name: userDetails?.name,
        })
        .then((actorMerge) =>
          loadSendComposer(deps.email.composer, {
            contextKey: EMAIL_CONTEXT.ORDER_CONFIRMATION,
            actorMerge,
            subjectVars: {
              orderNumber: order.orderNumber,
              quoteNumber: order.orderNumber,
              documentNumber: order.orderNumber,
              customerName: customer?.displayName ?? "Customer",
              total: formatCurrency(order.totalPrice) ?? "0.00",
            },
          }),
        ),
      deps.email.confirmationSendBlocked(String(order.id)),
    ]);
    orderConfirmation = composer;
    orderConfirmationSendBlocked = blocked;
  }

  const stripePaymentLinksEnabled = await deps.flags.stripePaymentLinks();
  const stripeConfigured = deps.flags.stripeConfigured();

  const [archivedLineItems, archiveRetentionDays, jobBoardOrderInput, jobBoardSettings] =
    await Promise.all([
      deps.orders.archivedLineItems(order.id),
      deps.orders.archiveRetentionDays(),
      isJobBoardEligible(order) ? deps.jobBoard.orderInput(order.id) : null,
      deps.jobBoard.settings(),
    ]);

  let quoteStripePaymentLinkId: string | null = null;
  let sourceQuote: { id: number; quoteNumber: string } | null = null;
  if (order.sourceQuoteId) {
    const row = await deps.orders.sourceQuote(order.sourceQuoteId);
    quoteStripePaymentLinkId = row?.stripePaymentLinkId ?? null;
    if (row?.quoteNumber) {
      sourceQuote = { id: order.sourceQuoteId, quoteNumber: row.quoteNumber };
    }
  }

  return {
    order,
    customer,
    vendor,
    vendors,
    notes,
    lineItems,
    parts,
    user,
    userDetails,
    pdfAutoDownload,
    events,
    canRevise,
    bananaEnabled,
    bananaModelUrl,
    outboundEmailEnabled,
    hideLineItemThumbnails,
    orderConfirmationEmailReady: orderConfirmation?.ready ?? false,
    orderConfirmationEmailDefaultSubject: orderConfirmation?.defaultSubject ?? null,
    orderConfirmationEditableSlots: orderConfirmation?.editableSlots ?? [],
    orderConfirmationRequiredAttachmentDocumentKinds:
      orderConfirmation?.requiredAttachmentDocumentKinds ?? [],
    orderConfirmationSendBlocked,
    stripePaymentLinksEnabled,
    stripeConfigured,
    quoteStripePaymentLinkId,
    sourceQuote,
    trackingNumbers,
    archivedLineItems: archivedLineItems.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      archivedAt: item.archivedAt.toISOString(),
      hardDeleteAt: item.hardDeleteAt.toISOString(),
      partId: item.partId,
    })),
    archiveRetentionDays,
    jobBoardOrderInput,
    jobBoardWebhookConfigured: jobBoardSettings.webhook.configured,
    jobBoardNotifyRoleId: jobBoardSettings.notifyRoleId,
  };
}
