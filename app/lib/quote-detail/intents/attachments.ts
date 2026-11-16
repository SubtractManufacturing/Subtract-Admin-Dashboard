/**
 * Quote attachment intents: upload and delete.
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
  redirectToQuote,
  type QuoteCtx,
} from "../context";
import type { QuoteDeps } from "../ports";

type Ctx = QuoteCtx<Pick<QuoteDeps, "attachments" | "files">>;

export const attachmentIntents: IntentTable<Ctx> = {
  async uploadAttachment(ctx, formData) {
    const file = formData.get("file");
    if (!file || typeof file === "string") return badRequest("No file provided");
    if (file.size > MAX_UPLOAD_BYTES) return badRequest("File size exceeds 10MB limit");

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
        },
        ctx.actor,
      );
      await ctx.deps.attachments.linkToQuote(ctx.quote.id, attachment.id);

      // Fetcher uploads ask for JSON so the page does not navigate away.
      if (formData.get("_noRedirect")) {
        return json({ success: true, attachmentId: attachment.id });
      }
      return redirectToQuote(ctx.quote);
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

    // Deleting something already gone is a no-op, not an error.
    const attachment = await ctx.deps.attachments.get(attachmentId);
    if (!attachment) return redirectToQuote(ctx.quote);

    const canDeleteProtected = canDeleteProtectedAttachments(ctx.auth);
    if (attachment.isProtected && !canDeleteProtected) {
      return forbidden("Admin or Dev role required to delete this protected attachment");
    }

    const onQuote = await ctx.deps.attachments.findOnQuote(
      attachmentId,
      ctx.quote.id,
      canDeleteProtected,
    );
    if (!onQuote) return notFound("Attachment not found on this Quote");

    await ctx.deps.attachments.unlinkFromQuote(ctx.quote.id, attachmentId);
    await ctx.deps.files.delete(onQuote.s3Key);
    await ctx.deps.attachments.delete(attachmentId, { ...ctx.actor, canDeleteProtected });

    return redirect(`/quotes/${ctx.quote.id}`);
  },
};
