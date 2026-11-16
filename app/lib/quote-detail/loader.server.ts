/**
 * Production adapter for the Quote detail loader: each port wired to its real
 * lib function. The assembly rules live in `./loader.ts`.
 */
import { eq } from "drizzle-orm";
import { db } from "~/lib/db";
import {
  attachments,
  quoteAttachments,
  quotePartDrawings,
} from "~/lib/db/schema";
import { getCustomer, getCustomers } from "~/lib/customers";
import { getLastQuoteReceivedSend } from "~/lib/email/enqueue-quote-received-email.server";
import { getQuoteReceivedEmailReadiness } from "~/lib/email/quote-received-email-readiness.server";
import { getEventsByEntity } from "~/lib/events";
import {
  canUserAccessPriceCalculator,
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
  getPlaceholderPartUrls,
} from "~/lib/developerSettings";
import { listArchivedQuoteLineItems } from "~/lib/line-item-archive.server";
import { getNotes } from "~/lib/notes";
import { getOrder } from "~/lib/orders";
import { getLatestCalculationsForQuote } from "~/lib/quotePriceCalculations";
import { getQuote } from "~/lib/quotes";
import {
  quotePartUsesPlaceholderCad,
  resolveQuotePartPreviewAssets,
} from "~/lib/quote-part-assets.server";
import { sendComposerAdapter } from "~/lib/route-actions/adapters.server";
import { extractS3Key, getDownloadUrl } from "~/lib/s3.server";
import { getVendor, getVendors } from "~/lib/vendors";
import type { QuoteLoaderDeps } from "./loader";

export function createQuoteLoaderDeps(): QuoteLoaderDeps {
  return {
    quotes: {
      get: getQuote,
      async attachments(quoteId) {
        const rows = await db
          .select({ attachment: attachments })
          .from(quoteAttachments)
          .leftJoin(attachments, eq(quoteAttachments.attachmentId, attachments.id))
          .where(eq(quoteAttachments.quoteId, quoteId));
        return rows
          .map((row) => row.attachment)
          .filter((a): a is NonNullable<typeof a> => a !== null);
      },
      priceCalculations: getLatestCalculationsForQuote,
      archivedLineItems: listArchivedQuoteLineItems,
      archiveRetentionDays: getLineItemArchiveRetentionDays,
      convertedOrder: getOrder,
    },
    directory: {
      customer: getCustomer,
      vendor: getVendor,
      customers: getCustomers,
      vendors: getVendors,
    },
    notes: getNotes,
    events: getEventsByEntity,
    flags: {
      priceCalculator: (role) => canUserAccessPriceCalculator(role),
      cadRevision: (role) => canUserUploadCadRevision(role),
      pdfAutoDownload: () => isFeatureEnabled(FEATURE_FLAGS.PDF_AUTO_DOWNLOAD),
      rejectionReasonRequired: () =>
        isFeatureEnabled(FEATURE_FLAGS.QUOTE_REJECTION_REASON_REQUIRED),
      bananaForScale: () => isFeatureEnabled(FEATURE_FLAGS.BANANA_FOR_SCALE),
      stripePaymentLinks: isStripePaymentLinksEnabled,
      outboundEmail: isOutboundEmailEnabled,
      hideLineItemThumbnails: shouldHideLineItemThumbnails,
    },
    async partViewPorts() {
      const globalPlaceholder = await getPlaceholderPartUrls();
      return {
        preview: (part) =>
          resolveQuotePartPreviewAssets(
            {
              specifications: part.specifications,
              partFileUrl: part.partFileUrl,
              partMeshUrl: part.partMeshUrl,
              conversionStatus: part.conversionStatus,
            },
            globalPlaceholder,
          ),
        usesPlaceholderCad: quotePartUsesPlaceholderCad,
        async meshUrl(partId) {
          const { getQuotePartMeshUrl } = await import(
            "~/lib/quote-part-mesh-converter.server"
          );
          return getQuotePartMeshUrl(partId, globalPlaceholder);
        },
        sign: getDownloadUrl,
        extractKey: extractS3Key,
        drawingRecords: (partId) =>
          db
            .select({ attachment: attachments })
            .from(quotePartDrawings)
            .leftJoin(attachments, eq(quotePartDrawings.attachmentId, attachments.id))
            .where(eq(quotePartDrawings.quotePartId, partId)),
      };
    },
    banana: {
      model: getBananaModelUrls,
      sign: (key) => getDownloadUrl(key),
    },
    email: {
      composer: sendComposerAdapter,
      // Lazy: pages with outbound email off never load the merge module.
      async actorMerge(source) {
        const { buildActorMergeMap } = await import("~/lib/email/resolve/actor-merge.server");
        return buildActorMergeMap(source);
      },
      receivedReadiness: getQuoteReceivedEmailReadiness,
      lastReceivedSend: getLastQuoteReceivedSend,
    },
  };
}
