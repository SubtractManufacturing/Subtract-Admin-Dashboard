/**
 * Production adapter for the Order detail loader: each port wired to its real
 * lib function. The assembly rules live in `./loader.ts`.
 */
import { eq } from "drizzle-orm";
import { db } from "~/lib/db";
import { attachments, partDrawings, quotes } from "~/lib/db/schema";
import { getCustomer } from "~/lib/customers";
import { EMAIL_CONTEXT } from "~/lib/email/email-context-registry";
import { getEventsForOrder } from "~/lib/events";
import {
  canUserUploadCadRevision,
  FEATURE_FLAGS,
  isFeatureEnabled,
  isOutboundEmailEnabled,
  isStripePaymentLinksEnabled,
  shouldHideLineItemThumbnails,
} from "~/lib/featureFlags";
import {
  getBananaModelUrls,
  getLineItemArchiveRetentionDays,
} from "~/lib/developerSettings";
import { getJobBoardSettings } from "~/lib/job-board/webhook-setting.server";
import { listArchivedOrderLineItems } from "~/lib/line-item-archive.server";
import { getLineItemsByOrderId } from "~/lib/lineItems";
import { getNotes } from "~/lib/notes";
import { getTrackingNumbersByOrderId } from "~/lib/order-tracking";
import { getOrderByNumberWithAttachments } from "~/lib/orders";
import { getPartsByCustomerId, hydratePartThumbnails } from "~/lib/parts";
import { sendComposerAdapter } from "~/lib/route-actions/adapters.server";
import { getDownloadUrl } from "~/lib/s3.server";
import { hasBlockingOrderContextSend } from "~/lib/sent-emails.server";
import { isStripeConfigured } from "~/lib/stripe.server";
import { getVendor, getVendors } from "~/lib/vendors";
import type { OrderLoaderDeps } from "./loader";

export function createOrderLoaderDeps(): OrderLoaderDeps {
  return {
    orders: {
      getByNumber: getOrderByNumberWithAttachments,
      lineItems: getLineItemsByOrderId,
      trackingNumbers: getTrackingNumbersByOrderId,
      archivedLineItems: listArchivedOrderLineItems,
      archiveRetentionDays: getLineItemArchiveRetentionDays,
      async sourceQuote(quoteId) {
        const [row] = await db
          .select({
            stripePaymentLinkId: quotes.stripePaymentLinkId,
            quoteNumber: quotes.quoteNumber,
          })
          .from(quotes)
          .where(eq(quotes.id, quoteId))
          .limit(1);
        return row ?? null;
      },
    },
    directory: {
      customer: getCustomer,
      vendor: getVendor,
      vendors: getVendors,
    },
    parts: {
      forCustomer: getPartsByCustomerId,
      hydrateThumbnails: hydratePartThumbnails,
      drawingRecords: (partId) =>
        db
          .select({ attachment: attachments })
          .from(partDrawings)
          .leftJoin(attachments, eq(partDrawings.attachmentId, attachments.id))
          .where(eq(partDrawings.partId, partId)),
    },
    notes: getNotes,
    events: getEventsForOrder,
    flags: {
      cadRevision: (role) => canUserUploadCadRevision(role),
      pdfAutoDownload: () => isFeatureEnabled(FEATURE_FLAGS.PDF_AUTO_DOWNLOAD),
      bananaForScale: () => isFeatureEnabled(FEATURE_FLAGS.BANANA_FOR_SCALE),
      stripePaymentLinks: isStripePaymentLinksEnabled,
      stripeConfigured: isStripeConfigured,
      outboundEmail: isOutboundEmailEnabled,
      hideLineItemThumbnails: shouldHideLineItemThumbnails,
    },
    sign: getDownloadUrl,
    bananaModel: getBananaModelUrls,
    jobBoard: {
      // Lazy: only Orders still waiting for a shop load the job-board data module.
      async orderInput(orderId) {
        const { loadJobBoardOrderInput } = await import("~/lib/job-board/order-data.server");
        return loadJobBoardOrderInput(orderId);
      },
      settings: getJobBoardSettings,
    },
    email: {
      composer: sendComposerAdapter,
      // Lazy: pages with outbound email off never load the merge module.
      async actorMerge(source) {
        const { buildActorMergeMap } = await import("~/lib/email/resolve/actor-merge.server");
        return buildActorMergeMap(source);
      },
      confirmationSendBlocked: (orderId) =>
        hasBlockingOrderContextSend(orderId, EMAIL_CONTEXT.ORDER_CONFIRMATION),
    },
  };
}
