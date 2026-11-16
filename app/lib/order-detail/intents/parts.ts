/**
 * Part intents on an Order: manufacturing attributes, mesh regeneration and
 * technical drawings.
 */
import { json } from "@remix-run/node";
import {
  badRequest,
  MAX_UPLOAD_BYTES,
  notFound,
  ok,
  serverError,
  type IntentTable,
} from "~/lib/route-actions/core";
import {
  collectDrawingFiles,
  uploadDrawings,
} from "~/lib/route-actions/drawing-uploads";
import {
  buildAttributeChangeEvents,
  diffAttributes,
  normalizeAttribute,
} from "~/lib/route-actions/part-attribute-changes";
import type { OrderCtx } from "../context";
import type { OrderDeps } from "../ports";

type Ctx = OrderCtx<
  Pick<OrderDeps, "parts" | "events" | "files" | "attachments" | "drawingUploads">
>;

const ATTRIBUTE_FIELDS = ["material", "tolerance", "finishing"] as const;

const text = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

export const partIntents: IntentTable<Ctx> = {
  async updatePartAttributes(ctx, formData) {
    const partId = text(formData, "partId");
    if (!partId) return badRequest("Part ID is required");

    const current = await ctx.deps.parts.find(partId);
    if (!current) return notFound("Part not found");

    const next = {
      material: normalizeAttribute(formData.get("material")),
      tolerance: normalizeAttribute(formData.get("tolerance")),
      finishing: normalizeAttribute(formData.get("finishing")),
    };
    await ctx.deps.parts.updateAttributes(partId, next);

    // One audit entry per field that actually changed.
    const events = buildAttributeChangeEvents({
      changes: diffAttributes(ATTRIBUTE_FIELDS, current, next),
      entityType: "part",
      entityId: partId,
      eventTypePrefix: "part",
      titlePrefix: "Part",
      partName: current.partName,
      metadata: { orderId: ctx.order.id, orderNumber: ctx.order.orderNumber },
      actor: ctx.actor,
    });
    for (const event of events) {
      await ctx.deps.events.create(event);
    }
    return ok();
  },

  async regenerateMesh(ctx, formData) {
    const partId = text(formData, "partId");
    if (!partId) return badRequest("Part ID is required");

    const part = await ctx.deps.parts.find(partId);
    if (!part?.partFileUrl) {
      return badRequest("No source file available for conversion");
    }

    await ctx.deps.parts.resetMeshConversion(partId);
    ctx.deps.parts
      .startMeshConversion(partId, part.partFileUrl)
      .catch((error) =>
        console.error(`Failed to regenerate mesh for part ${partId}:`, error),
      );
    return ok();
  },

  async addDrawingToPart(ctx, formData) {
    const partId = text(formData, "partId");
    const drawings = collectDrawingFiles(formData);
    if (!partId || drawings.length === 0) {
      return badRequest("Missing part ID or drawings");
    }

    const tooBig = drawings.find(({ file }) => file.size > MAX_UPLOAD_BYTES);
    if (tooBig) {
      const mb = (tooBig.file.size / 1024 / 1024).toFixed(2);
      return badRequest(`File "${tooBig.file.name}" exceeds 10MB limit (${mb}MB)`);
    }

    try {
      const uploaded = await uploadDrawings(ctx.deps.drawingUploads, {
        drawings,
        keyPrefix: `parts/${partId}/drawings`,
        link: (attachmentId) => ctx.deps.parts.linkDrawing(partId, attachmentId),
      });

      await ctx.deps.events.create({
        entityType: "order",
        entityId: String(ctx.order.id),
        eventType: "part_drawing_added",
        eventCategory: "system",
        title: "Technical Drawing Added",
        description: `Added ${uploaded.length} technical drawing(s) to part`,
        metadata: { partId, drawingCount: uploaded.length },
        userId: ctx.actor.userId,
        userEmail: ctx.actor.userEmail,
      });
      return json({ success: true, message: "Drawings uploaded successfully" });
    } catch (error) {
      console.error("Error uploading drawings:", error);
      return serverError("Failed to upload drawings");
    }
  },

  async deleteDrawingFromPart(ctx, formData) {
    const drawingId = text(formData, "drawingId");
    const partId = text(formData, "partId");
    if (!drawingId || !partId) return badRequest("Missing drawing ID or part ID");

    try {
      // Read the keys before the record disappears.
      const attachment = await ctx.deps.attachments.get(drawingId);
      if (!attachment) return notFound("Drawing not found");

      await ctx.deps.parts.unlinkDrawing(drawingId);
      await ctx.deps.attachments.removeRecord(drawingId);

      // The records are gone; a storage hiccup is logged, not surfaced.
      try {
        await ctx.deps.files.delete(attachment.s3Key);
        if (attachment.thumbnailS3Key) {
          await ctx.deps.files.delete(attachment.thumbnailS3Key);
        }
      } catch (s3Error) {
        console.error("Error deleting S3 files:", s3Error);
      }

      await ctx.deps.events.create({
        entityType: "order",
        entityId: String(ctx.order.id),
        eventType: "part_drawing_deleted",
        eventCategory: "system",
        title: "Technical Drawing Deleted",
        description: "Deleted technical drawing from part",
        metadata: { partId, drawingId, fileName: attachment.fileName },
        userId: ctx.actor.userId,
        userEmail: ctx.actor.userEmail,
      });
      return json({ success: true, message: "Drawing deleted successfully" });
    } catch (error) {
      console.error("Error deleting drawing:", error);
      return serverError("Failed to delete drawing");
    }
  },
};
