/**
 * Turn an uploaded file into a QuotePart: store the source, create the part,
 * kick off mesh conversion, and attach any technical drawings.
 *
 * Two shapes exist: a CAD upload (mesh conversion runs asynchronously) and a
 * drawing-only upload (the drawing itself becomes the part's preview source).
 */
import {
  contentTypeForDrawingFileName,
  isCadSourceFile,
  isDrawingSourceFile,
} from "~/lib/part-source-files";
import {
  collectDrawingFiles,
  sanitizeUploadFileName,
  uploadDrawings,
  type DrawingFile,
} from "~/lib/route-actions/drawing-uploads";
import { badRequest } from "~/lib/route-actions/core";
import type { QuoteCtx } from "./context";
import type { QuoteDeps } from "./ports";

type Ctx = QuoteCtx<
  Pick<QuoteDeps, "parts" | "files" | "events" | "drawingUploads" | "ids">
>;

export type NewPartFields = {
  name: string;
  description: string;
  material: string | null;
  tolerance: string | null;
  finish: string | null;
};

/**
 * Begin CAD to mesh conversion without making the request wait. A failure to
 * even start it is logged as a system event on the Quote.
 *
 * The returned promise never rejects; callers may ignore it (tests await it).
 */
export function startMeshConversionInBackground(
  ctx: QuoteCtx<Pick<QuoteDeps, "parts" | "events">>,
  part: { id: string; partName: string | null },
  sourceKey: string,
  labels: { title: string; failureVerb: string },
): Promise<void> {
  return ctx.deps.parts.startMeshConversion(part.id, sourceKey).catch(async (error) => {
    console.error(`${labels.failureVerb} for quote part ${part.id}:`, error);
    await ctx.deps.events
      .create({
        entityType: "quote",
        entityId: String(ctx.quote.id),
        eventType: "mesh_conversion_failed",
        eventCategory: "system",
        title: labels.title,
        description: `${labels.failureVerb} for part ${part.partName}`,
        metadata: {
          quotePartId: part.id,
          error: error instanceof Error ? error.message : String(error),
        },
        userId: ctx.actor.userId,
        userEmail: ctx.actor.userEmail,
      })
      .catch((err) => console.error("Failed to log event:", err));
  });
}

export const isSupportedPartUpload = (fileName: string) =>
  isCadSourceFile(fileName) || isDrawingSourceFile(fileName);

/**
 * Create a QuotePart from `file` (+ extra `drawing_<n>` files in `formData`).
 * Returns the new part id, or a 400 response when the file type is unusable.
 */
export async function createQuotePartFromUpload(
  ctx: Ctx,
  file: File,
  fields: NewPartFields,
  formData: FormData,
): Promise<{ ok: true; quotePartId: string } | { ok: false; response: Response }> {
  const primaryIsCad = isCadSourceFile(file.name);
  const primaryIsDrawing = isDrawingSourceFile(file.name);
  if (!primaryIsCad && !primaryIsDrawing) {
    return {
      ok: false,
      response: badRequest("Unsupported file type for line item upload"),
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base = {
    quoteId: ctx.quote.id,
    partNumber: ctx.deps.ids.quotePartNumber(),
    partName: fields.name,
    description: fields.description || null,
    material: fields.material,
    tolerance: fields.tolerance,
    finish: fields.finish,
  };
  const extraDrawings = collectDrawingFiles(formData);

  if (primaryIsDrawing && !primaryIsCad) {
    const part = await ctx.deps.parts.createDrawingOnly(base);
    const keyPrefix = `quote-parts/${part.id}/drawings`;
    const link = (attachmentId: string) =>
      ctx.deps.parts.linkDrawing(part.id, attachmentId);
    const contentTypeFor = (f: DrawingFile) => contentTypeForDrawingFileName(f.name);

    // The primary drawing takes slot 0; extra drawings follow at 1..n.
    await uploadDrawings(ctx.deps.drawingUploads, {
      drawings: [{ file, index: 0 }],
      keyPrefix,
      contentTypeFor,
      link,
    });
    await uploadDrawings(ctx.deps.drawingUploads, {
      drawings: extraDrawings,
      indexOffset: 1,
      keyPrefix,
      contentTypeFor,
      link,
    });
    await ctx.deps.parts.ensureDrawingOnlyAssets(part.id, {
      buffer,
      fileName: file.name,
    });
    return { ok: true, quotePartId: part.id };
  }

  const stored = await ctx.deps.files.upload({
    key: `quote-parts/${ctx.deps.ids.uuid()}/source/${sanitizeUploadFileName(file.name)}`,
    buffer,
    contentType: file.type || "application/octet-stream",
    fileName: sanitizeUploadFileName(file.name),
  });
  const part = await ctx.deps.parts.createFromCad({ ...base, partFileUrl: stored.key });

  void startMeshConversionInBackground(ctx, part, stored.key, {
    title: "Mesh Conversion Failed",
    failureVerb: "Failed to trigger mesh conversion",
  });

  await uploadDrawings(ctx.deps.drawingUploads, {
    drawings: extraDrawings,
    keyPrefix: `quote-parts/${part.id}/drawings`,
    link: (attachmentId) => ctx.deps.parts.linkDrawing(part.id, attachmentId),
  });
  return { ok: true, quotePartId: part.id };
}
