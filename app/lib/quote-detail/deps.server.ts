/**
 * Production adapters for the Quote detail seam (see `./ports.ts`).
 * Postgres, S3, Stripe and the email queue meet the intent handlers here and
 * nowhere else.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { startOfTodayInAppTz } from "~/lib/business-days";
import { db } from "~/lib/db";
import {
  quoteAttachments,
  quoteLineItems,
  quotePartDrawings,
  quoteParts,
  quotes as quotesTable,
} from "~/lib/db/schema";
import { enqueueQuoteReceivedUserEmail } from "~/lib/email/enqueue-quote-received-email.server";
import {
  handleEmailPreviewAction,
  handleEmailQueueAction,
} from "~/lib/email/outbound-email-route-actions.server";
import {
  authorizeAttachmentDeletion,
  createAttachment,
  deleteAttachment,
  getAttachment,
} from "~/lib/attachments";
import { isOutboundEmailEnabled, isStripePaymentLinksEnabled } from "~/lib/featureFlags";
import {
  archiveQuoteLineItem,
  restoreQuoteLineItem,
} from "~/lib/line-item-archive.server";
import {
  archiveQuote,
  calculateQuoteTotals,
  convertQuoteToOrder,
  createQuoteLineItem,
  duplicateQuote,
  restoreQuote,
  updateQuote,
  updateQuoteLineItem,
} from "~/lib/quotes";
import { transitionQuoteToSent } from "~/lib/quotes.server";
import { createPriceCalculation } from "~/lib/quotePriceCalculations";
import {
  ensureDrawingOnlyQuotePartAssets,
  quotePartUsesPlaceholderCad,
} from "~/lib/quote-part-assets.server";
import { triggerQuotePartMeshConversion } from "~/lib/quote-part-mesh-converter.server";
import {
  documentsAdapter,
  drawingUploadsAdapter,
  eventsAdapter,
  filesAdapter,
  notesAdapter,
} from "~/lib/route-actions/adapters.server";
import { deactivateQuotePaymentLink } from "~/lib/stripe.server";
import type { QuoteDeps } from "./ports";

type NewPriceCalculation = Parameters<typeof createPriceCalculation>[0];

export function createQuoteDeps(): QuoteDeps {
  return {
    quotes: {
      update: (id, updates, actor) => updateQuote(id, updates, actor),
      archive: archiveQuote,
      restore: restoreQuote,
      convertToOrder: convertQuoteToOrder,
      duplicate: duplicateQuote,
      transitionToSent: transitionQuoteToSent,
      async resetToDraftForRevision(id) {
        await db
          .update(quotesTable)
          .set({
            status: "Draft",
            stripePaymentLinkUrl: null,
            stripePaymentLinkId: null,
            stripePaymentLinkActive: null,
            updatedAt: new Date(),
          })
          .where(eq(quotesTable.id, id));
      },
      recalculateTotals: calculateQuoteTotals,
      savePriceCalculation: (data, userId) =>
        createPriceCalculation(data as NewPriceCalculation, userId as string),
    },

    lineItems: {
      async find(id) {
        const [row] = await db
          .select()
          .from(quoteLineItems)
          .where(eq(quoteLineItems.id, id))
          .limit(1);
        return row ?? null;
      },
      list: (quoteId, scope) =>
        db
          .select()
          .from(quoteLineItems)
          .where(
            scope === "active"
              ? and(eq(quoteLineItems.quoteId, quoteId), eq(quoteLineItems.isArchived, false))
              : eq(quoteLineItems.quoteId, quoteId),
          ),
      create: (quoteId, data, actor) => createQuoteLineItem(quoteId, data, actor),
      update: (id, data, actor) => updateQuoteLineItem(id, data, actor),
      async linkToPart(id, patch) {
        await db
          .update(quoteLineItems)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(quoteLineItems.id, id));
      },
      archive: archiveQuoteLineItem,
      restore: restoreQuoteLineItem,
    },

    parts: {
      async find(id) {
        const [row] = await db
          .select()
          .from(quoteParts)
          .where(eq(quoteParts.id, id))
          .limit(1);
        return row ?? null;
      },
      async createFromCad(input) {
        const [row] = await db
          .insert(quoteParts)
          .values({ ...input, conversionStatus: "pending" })
          .returning();
        return row;
      },
      async createDrawingOnly(input) {
        const [row] = await db
          .insert(quoteParts)
          .values({
            ...input,
            partFileUrl: null,
            conversionStatus: "pending",
            specifications: { primarySource: "drawing_only" },
          })
          .returning();
        return row;
      },
      ensureDrawingOnlyAssets: (quotePartId, primary) =>
        ensureDrawingOnlyQuotePartAssets(quotePartId, {
          primaryDrawingBuffer: primary.buffer,
          primaryDrawingFileName: primary.fileName,
        }),
      usesPlaceholderCad: quotePartUsesPlaceholderCad,
      async updateAttributes(id, attrs) {
        await db
          .update(quoteParts)
          .set({ ...attrs, updatedAt: new Date() })
          .where(eq(quoteParts.id, id));
      },
      async resetMeshConversion(id) {
        await db
          .update(quoteParts)
          .set({
            conversionStatus: "pending",
            meshConversionError: null,
            updatedAt: new Date(),
          })
          .where(eq(quoteParts.id, id));
      },
      async startMeshConversion(id, sourceKey) {
        await triggerQuotePartMeshConversion(id, sourceKey);
      },
      async linkDrawing(quotePartId, attachmentId) {
        await db.insert(quotePartDrawings).values({ quotePartId, attachmentId, version: 1 });
      },
      async unlinkDrawing(attachmentId) {
        await db
          .delete(quotePartDrawings)
          .where(eq(quotePartDrawings.attachmentId, attachmentId));
      },
    },

    attachments: {
      get: getAttachment,
      create: (data, actor) => createAttachment(data, actor),
      delete: (id, actor) => deleteAttachment(id, actor),
      findOnQuote: (attachmentId, quoteId, canDeleteProtected) =>
        authorizeAttachmentDeletion({
          attachmentId,
          entityType: "quote",
          entityId: quoteId,
          eventContext: { canDeleteProtected },
        }),
      async linkToQuote(quoteId, attachmentId) {
        await db.insert(quoteAttachments).values({ quoteId, attachmentId });
      },
      async unlinkFromQuote(quoteId, attachmentId) {
        await db
          .delete(quoteAttachments)
          .where(
            and(
              eq(quoteAttachments.attachmentId, attachmentId),
              eq(quoteAttachments.quoteId, quoteId),
            ),
          );
      },
    },

    files: filesAdapter,
    events: eventsAdapter,
    stripe: {
      enabled: isStripePaymentLinksEnabled,
      deactivatePaymentLink: deactivateQuotePaymentLink,
    },
    email: {
      outboundEnabled: isOutboundEmailEnabled,
      preview: handleEmailPreviewAction,
      queue: handleEmailQueueAction,
      enqueueQuoteReceived: enqueueQuoteReceivedUserEmail,
    },
    clock: { today: startOfTodayInAppTz },
    ids: {
      quotePartNumber: () => `QP-${Date.now()}-${randomBytes(4).toString("hex")}`,
      uuid: randomUUID,
    },
    drawingUploads: drawingUploadsAdapter,
    documents: documentsAdapter,
    notes: notesAdapter,
  };
}
