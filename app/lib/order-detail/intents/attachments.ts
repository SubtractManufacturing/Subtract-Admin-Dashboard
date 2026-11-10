/**
 * Order attachment intents: upload, delete and get a download link.
 */
import { json, redirect } from "@remix-run/node";
import {
  badRequest,
  forbidden,
  MAX_UPLOAD_BYTES,
  notFound,
  serverError,
  type IntentTable,
} from "~/lib/route-actions/core";
import {
  canDeleteProtectedAttachments,
  orderHref,
  redirectToOrder,
  type OrderCtx,
} from "../context";
import type { OrderDeps } from "../ports";

type Ctx = OrderCtx<Pick<OrderDeps, "attachments" | "files">>;

export const attachmentIntents: IntentTable<Ctx> = {
  async uploadAttachment(ctx, formData) {
    const file = formData.get("file");
    if (!file || typeof file === "string") return badRequest("No file provided");
    if (file.size > MAX_UPLOAD_BYTES) return badRequest("File size exceeds 10MB limit");

    try {
      const stored = await ctx.deps.files.upload({
        key: ctx.deps.files.keyFor(ctx.order.id, file.name),
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
        },
        ctx.actor,
      );
      await ctx.deps.attachments.linkToOrder(ctx.order.id, attachment.id, ctx.actor);

      // Fetcher uploads ask for JSON so the page does not navigate away.
      if (formData.get("_noRedirect")) {
        return json({ success: true, attachmentId: attachment.id });
      }
      return redirectToOrder(ctx.order);
    } catch (error) {
      console.error("Upload error:", error);
      return serverError("Failed to upload file");
    }
  },

  async deleteAttachment(ctx, formData) {
    const attachmentId = formData.get("attachmentId");
    if (typeof attachmentId !== "string" || !attachmentId) {
      return badRequest("Missing attachment ID");
    }

    const attachment = await ctx.deps.attachments.get(attachmentId);
    if (!attachment) return notFound("Attachment not found");

    const canDeleteProtected = canDeleteProtectedAttachments(ctx.auth);
    if (attachment.isProtected && !canDeleteProtected) {
      return forbidden("Admin or Dev role required to delete this protected attachment");
    }

    const actor = { ...ctx.actor, canDeleteProtected };
    const onOrder = await ctx.deps.attachments.findOnOrder(
      attachmentId,
      ctx.order.id,
      actor,
    );
    if (!onOrder) return notFound("Attachment not found on this Order");

    // Unlink first so a failed file delete cannot leave a dangling link.
    await ctx.deps.attachments.unlinkFromOrder(ctx.order.id, attachmentId, actor);
    await ctx.deps.files.delete(onOrder.s3Key);
    await ctx.deps.attachments.delete(attachmentId, actor);

    return redirect(orderHref(ctx.order));
  },

  async downloadAttachment(ctx, formData) {
    const attachmentId = formData.get("attachmentId");
    if (typeof attachmentId !== "string" || !attachmentId) {
      return badRequest("Missing attachment ID");
    }

    const attachment = await ctx.deps.attachments.get(attachmentId);
    if (!attachment) return notFound("Attachment not found");

    return json({ downloadUrl: await ctx.deps.files.signedUrl(attachment.s3Key) });
  },
};
