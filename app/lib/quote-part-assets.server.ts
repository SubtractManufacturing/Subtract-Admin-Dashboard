/**
 * Quote part assets for drawing-only parts: copy global placeholder CAD/mesh into quote-part paths.
 */

import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { quoteParts } from "./db/schema";
import { copyFile, uploadFile } from "./s3.server";
import { getPlaceholderPartUrlsWithBananaFallback } from "./developerSettings";
import { generatePdfThumbnail, isPdfFile } from "./pdf-thumbnail.server";
import { contentTypeForDrawingFileName } from "./part-source-files";

export class PlaceholderPartAssetsMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaceholderPartAssetsMissingError";
  }
}

export interface EnsureDrawingOnlyQuotePartAssetsOptions {
  /** First-page PDF buffer or image buffer for list thumbnail */
  primaryDrawingBuffer?: Buffer;
  primaryDrawingFileName?: string;
}

/**
 * Copy developer-settings placeholder CAD + mesh into this quote part and mark conversion completed.
 * Does not create cad_file_versions rows (placeholder is not a user revision).
 */
export async function ensureDrawingOnlyQuotePartAssets(
  quotePartId: string,
  options?: EnsureDrawingOnlyQuotePartAssetsOptions
): Promise<void> {
  const { cadUrl: globalCadKey, meshUrl: globalMeshKey } =
    await getPlaceholderPartUrlsWithBananaFallback();

  if (!globalCadKey?.trim() || !globalMeshKey?.trim()) {
    throw new PlaceholderPartAssetsMissingError(
      "Drawing-only parts need placeholder CAD and mesh in Settings → Developer (Placeholder part), or configure the Banana model upload there to use the same assets."
    );
  }

  const cadBase = globalCadKey.split("/").pop() || "placeholder.step";
  const meshBase = globalMeshKey.split("/").pop() || "placeholder.glb";
  const timestamp = Date.now();

  const destCadKey = `quote-parts/${quotePartId}/source/${timestamp}-placeholder-${cadBase}`;
  const destMeshKey = `quote-parts/${quotePartId}/mesh/${timestamp}-placeholder-${meshBase}`;

  await copyFile(globalCadKey, destCadKey);
  await copyFile(globalMeshKey, destMeshKey);

  let thumbnailUrl: string | null = null;
  if (options?.primaryDrawingBuffer && options.primaryDrawingFileName) {
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
        thumbnailUrl = thumbKey;
      } else if (ct.startsWith("image/")) {
        const thumbKey = `quote-parts/${quotePartId}/thumbnails/${timestamp}-primary-${fn.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "")}`;
        await uploadFile({
          key: thumbKey,
          buffer: options.primaryDrawingBuffer,
          contentType: ct,
          fileName: fn,
        });
        thumbnailUrl = thumbKey;
      }
    } catch (e) {
      console.error("Thumbnail generation for drawing-only part failed:", e);
    }
  }

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

  await db
    .update(quoteParts)
    .set({
      partFileUrl: destCadKey,
      partMeshUrl: destMeshKey,
      conversionStatus: "completed",
      meshConversionError: null,
      meshConversionCompletedAt: new Date(),
      thumbnailUrl,
      specifications: specs,
      updatedAt: new Date(),
    })
    .where(eq(quoteParts.id, quotePartId));
}
