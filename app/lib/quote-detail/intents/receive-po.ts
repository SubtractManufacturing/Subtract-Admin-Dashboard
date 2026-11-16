/**
 * "Receive PO": a Sent quote is accepted by uploading the customer's purchase
 * order, which converts it to an Order in one step.
 */
import { isAllowedCustomerPoFile } from "~/lib/customer-po";
import {
  badRequest,
  MAX_UPLOAD_BYTES,
  serverError,
  type IntentTable,
} from "~/lib/route-actions/core";
import type { QuoteCtx } from "../context";
import type { QuoteDeps } from "../ports";
import {
  acceptanceBlockedResponse,
  convertAndRedirect,
  deactivatePaymentLink,
} from "./lifecycle";

type Ctx = QuoteCtx<
  Pick<QuoteDeps, "quotes" | "stripe" | "events" | "clock" | "attachments" | "files">
>;

export const receivePoIntents: IntentTable<Ctx> = {
  async receivePo(ctx, formData) {
    if (ctx.quote.status !== "Sent") {
      return badRequest("Quote must be Sent to receive a customer PO");
    }
    if (ctx.quote.convertedToOrderId) {
      return badRequest("Quote has already been converted to an order");
    }

    const poNumberRaw = formData.get("poNumber");
    const poNumber = typeof poNumberRaw === "string" ? poNumberRaw.trim() : "";
    const file = formData.get("file");

    if (!poNumber) return badRequest("PO number is required");
    if (!file || typeof file === "string" || file.size <= 0) {
      return badRequest("Customer PO file is required");
    }
    if (file.size > MAX_UPLOAD_BYTES) return badRequest("File size exceeds 10MB limit");
    if (!isAllowedCustomerPoFile(file.type, file.name)) {
      return badRequest("Customer PO must be a PDF or image (PNG, JPG, or WebP)");
    }

    // Same gate as "Mark as Accepted".
    const blocked = acceptanceBlockedResponse(ctx.quote);
    if (blocked) return blocked;

    try {
      const stored = await ctx.deps.files.upload({
        key: ctx.deps.files.keyFor(ctx.quote.id, file.name),
        buffer: Buffer.from(await file.arrayBuffer()),
        contentType: file.type || "application/octet-stream",
        fileName: file.name,
      });
      const attachment = await ctx.deps.attachments.create(
        {
          s3Bucket: stored.bucket,
          s3Key: stored.key,
          fileName: stored.fileName,
          contentType: stored.contentType,
          fileSize: stored.size,
          source: "user_upload",
          documentKind: "customer_purchase_order",
        },
        ctx.actor,
      );
      await ctx.deps.attachments.linkToQuote(ctx.quote.id, attachment.id);

      await deactivatePaymentLink(ctx, {
        markInactiveOnQuote: true,
        failureLabel: "Stripe deactivation failed:",
      });

      return await convertAndRedirect(ctx, "Failed to convert quote to order", {
        poNumber,
        viaCustomerPo: true,
        customerPoAttachmentId: attachment.id,
      });
    } catch (error) {
      console.error("Receive PO error:", error);
      return serverError("Failed to receive customer PO");
    }
  },
};
