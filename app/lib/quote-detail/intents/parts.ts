/**
 * QuotePart intents: attributes, mesh regeneration, and technical drawings.
 */
import {
  badRequest,
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
import { redirectToQuote, type QuoteCtx } from "../context";
import { startMeshConversionInBackground } from "../part-intake";
import type { QuoteDeps } from "../ports";

type Ctx = QuoteCtx<
  Pick<QuoteDeps, "parts" | "events" | "drawingUploads" | "attachments" | "files">
>;

const ATTRIBUTE_FIELDS = ["material", "tolerance", "finish"] as const;

export const partIntents: IntentTable<Ctx> = {
  async updateQuotePartAttributes(ctx, formData) {
    const quotePartId = formData.get("quotePartId");
    if (typeof quotePartId !== "string" || !quotePartId) {
      return badRequest("Quote part ID is required");
    }

    const current = await ctx.deps.parts.find(quotePartId);
    if (!current) return notFound("Quote part not found");

    const next = {
      material: normalizeAttribute(formData.get("material")),
      tolerance: normalizeAttribute(formData.get("tolerance")),
      finish: normalizeAttribute(formData.get("finish")),
    };
    await ctx.deps.parts.updateAttributes(quotePartId, next);

    // One audit entry per field that actually changed.
    const events = buildAttributeChangeEvents({
      changes: diffAttributes(ATTRIBUTE_FIELDS, current, next),
      entityType: "quote",
      entityId: String(ctx.quote.id),
      eventTypePrefix: "quote_part",
      titlePrefix: "Quote Part",
      partName: current.partName,
      metadata: {
        quotePartId,
        quoteId: ctx.quote.id,
        quoteNumber: ctx.quote.quoteNumber,
      },
      actor: ctx.actor,
    });
    for (const event of events) {
      await ctx.deps.events.create(event);
    }

    return ok();
  },

  async regenerateMesh(ctx, formData) {
    const partId = formData.get("partId");
    if (typeof partId !== "string" || !partId) {
      return badRequest("Part ID is required");
    }

    const part = await ctx.deps.parts.find(partId);
    if (!part) return notFound("Quote part not found");

    if (ctx.deps.parts.usesPlaceholderCad(part.specifications)) {
      return badRequest(
        "Preview mesh is managed in Settings. Upload a CAD file to regenerate mesh for this part.",
      );
    }
    if (!part.partFileUrl) {
      return badRequest("No source file available for conversion");
    }

    await ctx.deps.parts.resetMeshConversion(partId);
    void startMeshConversionInBackground(ctx, part, part.partFileUrl, {
      title: "Mesh Regeneration Failed",
      failureVerb: "Failed to regenerate mesh",
    });
    return ok();
  },

  async addDrawingToExistingPart(ctx, formData) {
    const quotePartId = formData.get("quotePartId");
    const drawings = collectDrawingFiles(formData);
    if (typeof quotePartId !== "string" || !quotePartId || drawings.length === 0) {
      return badRequest("Missing quote part ID or drawings");
    }

    try {
      await uploadDrawings(ctx.deps.drawingUploads, {
        drawings,
        keyPrefix: `quote-parts/${quotePartId}/drawings`,
        link: (attachmentId) => ctx.deps.parts.linkDrawing(quotePartId, attachmentId),
      });
      return redirectToQuote(ctx.quote);
    } catch (error) {
      console.error("Error adding drawings to existing part:", error);
      return serverError("Failed to add drawings");
    }
  },

  async deleteDrawing(ctx, formData) {
    const drawingId = formData.get("drawingId");
    const quotePartId = formData.get("quotePartId");
    if (
      typeof drawingId !== "string" ||
      !drawingId ||
      typeof quotePartId !== "string" ||
      !quotePartId
    ) {
      return badRequest("Missing drawing or quote part ID");
    }

    await ctx.deps.parts.unlinkDrawing(drawingId);

    const attachment = await ctx.deps.attachments.get(drawingId);
    if (attachment) {
      await ctx.deps.files.delete(attachment.s3Key);
      await ctx.deps.attachments.delete(drawingId, ctx.actor);
    }
    return redirectToQuote(ctx.quote);
  },
};
