/**
 * Production adapters for the Order detail seam (see `./ports.ts`).
 * Postgres, S3, Discord, Stripe and the email queue meet the intent handlers
 * here and nowhere else.
 */
import { eq } from "drizzle-orm";
import { db } from "~/lib/db";
import {
  attachments as attachmentsTable,
  orderLineItems,
  partDrawings,
  parts,
} from "~/lib/db/schema";
import {
  authorizeAttachmentDeletion,
  createAttachment,
  deleteAttachment,
  getAttachment,
  linkAttachmentToOrder,
  unlinkAttachmentFromOrder,
} from "~/lib/attachments";
import {
  handleEmailPreviewAction,
  handleEmailQueueAction,
} from "~/lib/email/outbound-email-route-actions.server";
import {
  archiveOrderLineItem,
  restoreOrderLineItem,
} from "~/lib/line-item-archive.server";
import { createLineItem, updateLineItem } from "~/lib/lineItems";
import { duplicateOrder, restoreOrder, updateOrder } from "~/lib/orders";
import {
  addTrackingNumbers,
  deleteTrackingNumbers,
  updateTrackingNumbers,
  willHaveTrackingNumbersAfterChanges,
} from "~/lib/order-tracking";
import { createPart, getPart } from "~/lib/parts";
import {
  documentsAdapter,
  drawingUploadsAdapter,
  eventsAdapter,
  filesAdapter,
  notesAdapter,
} from "~/lib/route-actions/adapters.server";
import type { OrderDeps } from "./ports";

type NewOrderLine = Parameters<typeof createLineItem>[0];

export function createOrderDeps(): OrderDeps {
  return {
    orders: {
      update: (id, updates, actor) => updateOrder(id, updates, actor),
      restore: restoreOrder,
      duplicate: duplicateOrder,
    },

    lineItems: {
      async find(id) {
        const [row] = await db
          .select()
          .from(orderLineItems)
          .where(eq(orderLineItems.id, id))
          .limit(1);
        return row ?? null;
      },
      list: (orderId) =>
        db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId)),
      create: (data, actor) => createLineItem(data as NewOrderLine, actor),
      update: (id, data, actor) => updateLineItem(id, data, actor),
      archive: archiveOrderLineItem,
      restore: restoreOrderLineItem,
    },

    parts: {
      find: getPart,
      create: (data, actor) => createPart(data, actor),
      async updateAttributes(id, attrs) {
        await db
          .update(parts)
          .set({ ...attrs, updatedAt: new Date() })
          .where(eq(parts.id, id));
      },
      async resetMeshConversion(id) {
        await db
          .update(parts)
          .set({
            meshConversionStatus: "pending",
            meshConversionError: null,
            updatedAt: new Date(),
          })
          .where(eq(parts.id, id));
      },
      async startMeshConversion(id, sourceKey) {
        const { triggerPartMeshConversion } = await import("~/lib/part-mesh-converter.server");
        await triggerPartMeshConversion(id, sourceKey);
      },
      async linkDrawing(partId, attachmentId) {
        await db.insert(partDrawings).values({ partId, attachmentId, version: 1 });
      },
      async unlinkDrawing(attachmentId) {
        await db.delete(partDrawings).where(eq(partDrawings.attachmentId, attachmentId));
      },
    },

    attachments: {
      get: getAttachment,
      create: (data, actor) => createAttachment(data, actor),
      delete: (id, actor) => deleteAttachment(id, actor),
      async removeRecord(id) {
        await db.delete(attachmentsTable).where(eq(attachmentsTable.id, id));
      },
      findOnOrder: (attachmentId, orderId, actor) =>
        authorizeAttachmentDeletion({
          attachmentId,
          entityType: "order",
          entityId: orderId,
          eventContext: actor,
        }),
      linkToOrder: linkAttachmentToOrder,
      unlinkFromOrder: unlinkAttachmentFromOrder,
    },

    tracking: {
      add: addTrackingNumbers,
      remove: deleteTrackingNumbers,
      update: updateTrackingNumbers,
      willHaveAfterChanges: willHaveTrackingNumbersAfterChanges,
    },

    jobBoard: {
      async settings() {
        const { getJobBoardSettings } = await import("~/lib/job-board/webhook-setting.server");
        const settings = await getJobBoardSettings();
        return { webhookUrl: settings.webhook.url ?? null };
      },
      async assertEligible(orderId) {
        const { assertOrderEligibleForJobBoard } = await import("~/lib/job-board/order-data.server");
        return assertOrderEligibleForJobBoard(orderId);
      },
      async assertEligibleForPost(orderId) {
        const { assertOrderEligibleForJobBoardPost } = await import("~/lib/job-board/order-data.server");
        return assertOrderEligibleForJobBoardPost(orderId);
      },
      async loadOrderInput(orderId) {
        const { loadJobBoardOrderInput } = await import("~/lib/job-board/order-data.server");
        return loadJobBoardOrderInput(orderId);
      },
      async sendPost({ actor, ...params }) {
        const { sendJobBoardPost } = await import("~/lib/job-board/sender.server");
        const { createFetchDiscordWebhookClient } = await import(
          "~/lib/job-board/discord-webhook.server"
        );
        return sendJobBoardPost({
          ...params,
          discord: createFetchDiscordWebhookClient(),
          eventContext: actor,
        });
      },
      async markAsSent({ actor, ...params }) {
        const { markJobBoardAsSent } = await import("~/lib/job-board/sender.server");
        await markJobBoardAsSent({ ...params, eventContext: actor });
      },
      async updateClaim(params) {
        const { updateJobBoardClaim } = await import("~/lib/job-board/claim-updater.server");
        const { createFetchDiscordWebhookClient } = await import(
          "~/lib/job-board/discord-webhook.server"
        );
        return updateJobBoardClaim({ ...params, discord: createFetchDiscordWebhookClient() });
      },
    },

    checkoutAddresses: {
      async importQuick({ actor, ...params }) {
        const { importCheckoutAddressesQuickFromOrder } = await import(
          "~/lib/stripe/checkout-addresses.server"
        );
        return importCheckoutAddressesQuickFromOrder({ ...params, eventContext: actor });
      },
      async applyChoices({ actor, ...params }) {
        const { applyCheckoutAddressImportForOrder } = await import(
          "~/lib/stripe/checkout-addresses.server"
        );
        return applyCheckoutAddressImportForOrder({ ...params, eventContext: actor });
      },
    },

    email: { preview: handleEmailPreviewAction, queue: handleEmailQueueAction },
    files: filesAdapter,
    events: eventsAdapter,
    drawingUploads: drawingUploadsAdapter,
    documents: documentsAdapter,
    notes: notesAdapter,
  };
}
