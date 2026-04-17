/**
 * Drawing-only quote parts: preview CAD/mesh resolve from Settings (`getPlaceholderPartUrls`).
 * Not copied to per-part S3 keys; not deliverable CAD (see downloadQuoteFiles, convertQuoteToOrder).
 */

import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { quoteParts } from "./db/schema";
import { uploadFile } from "./s3.server";
import { getPlaceholderPartUrls } from "./developerSettings";
import { generatePdfThumbnail, isPdfFile } from "./pdf-thumbnail.server";
import { contentTypeForDrawingFileName } from "./part-source-files";

export type PlaceholderPartUrls = Awaited<
  ReturnType<typeof getPlaceholderPartUrls>
>;

export interface QuotePartPreviewResolution {
  /** S3 keys for in-app preview (signed URLs built by callers). */
  cadKey: string | null;
  meshKey: string | null;
  /** Matches UI expectations for mesh availability (e.g. loader checks `completed`). */
  effectiveConversionStatus: "completed" | "skipped";
}

export function quotePartUsesPlaceholderCad(specifications: unknown): boolean {
  const specs = specifications as Record<string, unknown> | null | undefined;
  return specs?.usesPlaceholderCad === true;
}

/**
 * CAD/mesh keys for 3D preview. When `usesPlaceholderCad`, keys come from Settings (live pointer);
 * legacy per-part copied keys are ignored for preview.
 * Non-placeholder parts use stored `partFileUrl` / `partMeshUrl`.
 */
export function resolveQuotePartPreviewAssets(
  part: {
    specifications: unknown;
    partFileUrl: string | null;
    partMeshUrl: string | null;
    conversionStatus: string | null;
  },
  globalPlaceholder: PlaceholderPartUrls
): QuotePartPreviewResolution {
  if (!quotePartUsesPlaceholderCad(part.specifications)) {
    const completed = part.conversionStatus === "completed";
    return {
      cadKey: part.partFileUrl?.trim() || null,
      meshKey: part.partMeshUrl?.trim() || null,
      effectiveConversionStatus: completed ? "completed" : "skipped",
    };
  }

  const cad = globalPlaceholder.cadUrl?.trim() || null;
  const mesh = globalPlaceholder.meshUrl?.trim() || null;
  const globalReady =
    !!cad &&
    !!mesh &&
    globalPlaceholder.conversionStatus === "completed";

  return {
    cadKey: cad,
    meshKey: mesh,
    effectiveConversionStatus: globalReady ? "completed" : "skipped",
  };
}

export interface EnsureDrawingOnlyQuotePartAssetsOptions {
  /** First-page PDF buffer or image buffer for list thumbnail */
  primaryDrawingBuffer?: Buffer;
  primaryDrawingFileName?: string;
}

async function resolvePrimaryDrawingThumbnail(
  quotePartId: string,
  options: EnsureDrawingOnlyQuotePartAssetsOptions | undefined,
  timestamp: number
): Promise<string | null> {
  if (!options?.primaryDrawingBuffer || !options?.primaryDrawingFileName) {
    return null;
  }
  const fn = options.primaryDrawingFileName;
  const ct = contentTypeForDrawingFileName(fn);
  try {
    if (isPdfFile(ct, fn)) {
      const thumb = await generatePdfThumbnail(
        options.primaryDrawingBuffer,
        200,
        200
      );
      const thumbKey = `quote-parts/${quotePartId}/thumbnails/${timestamp}-primary.png`;
      await uploadFile({
        key: thumbKey,
        buffer: thumb.buffer,
        contentType: "image/png",
        fileName: `${timestamp}-primary.png`,
      });
      return thumbKey;
    }
    if (ct.startsWith("image/")) {
      const thumbKey = `quote-parts/${quotePartId}/thumbnails/${timestamp}-primary-${fn.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "")}`;
      await uploadFile({
        key: thumbKey,
        buffer: options.primaryDrawingBuffer,
        contentType: ct,
        fileName: fn,
      });
      return thumbKey;
    }
  } catch (e) {
    console.error("Thumbnail generation for drawing-only part failed:", e);
  }
  return null;
}

/**
 * Drawing-only line item: tie preview mesh/CAD to the global Settings placeholder (no per-part S3 copy).
 * When placeholder is incomplete, conversion is skipped so the UI does not spin.
 */
export async function ensureDrawingOnlyQuotePartAssets(
  quotePartId: string,
  options?: EnsureDrawingOnlyQuotePartAssetsOptions
): Promise<void> {
  const globalPlaceholder = await getPlaceholderPartUrls();

  const timestamp = Date.now();
  const thumbnailUrl = await resolvePrimaryDrawingThumbnail(
    quotePartId,
    options,
    timestamp
  );

  const [existing] = await db
    .select({ specifications: quoteParts.specifications })
    .from(quoteParts)
    .where(eq(quoteParts.id, quotePartId))
    .limit(1);

  const specs = {
    ...((existing?.specifications as Record<string, unknown>) ?? {}),
    usesPlaceholderCad: true,
    primarySource: "drawing_only",
  };

  const preview = resolveQuotePartPreviewAssets(
    {
      specifications: specs,
      partFileUrl: null,
      partMeshUrl: null,
      conversionStatus: null,
    },
    globalPlaceholder
  );

  const conversionStatus = preview.effectiveConversionStatus;
  const meshConversionCompletedAt =
    conversionStatus === "completed" ? new Date() : null;

  await db
    .update(quoteParts)
    .set({
      partFileUrl: null,
      partMeshUrl: null,
      conversionStatus,
      meshConversionError: null,
      meshConversionCompletedAt,
      thumbnailUrl,
      specifications: specs,
      updatedAt: new Date(),
    })
    .where(eq(quoteParts.id, quotePartId));
}
