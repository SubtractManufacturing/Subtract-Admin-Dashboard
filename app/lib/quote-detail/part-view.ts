/**
 * Turn a stored QuotePart into what the Quote page renders: signed URLs for the
 * source file, preview mesh and thumbnail, plus its signed technical drawings.
 *
 * Signing and lookups sit behind {@link PartViewPorts}, so the placeholder-CAD
 * and failure-tolerance rules can be tested without S3 or Postgres.
 */
import {
  signDrawingAttachments,
  type SignedDrawing,
  type StoredDrawingAttachment,
} from "~/lib/route-actions/signed-drawings";

export const PART_URL_TTL_SECONDS = 3600;

export type PartViewSource = {
  id: string;
  specifications: unknown;
  partFileUrl: string | null;
  partMeshUrl: string | null;
  conversionStatus: string | null;
  thumbnailUrl: string | null;
};

export type PartViewPorts = {
  /** Which CAD/mesh keys to preview, and whether conversion is done. */
  preview(part: PartViewSource): {
    cadKey: string | null;
    meshKey: string | null;
    effectiveConversionStatus: string;
  };
  usesPlaceholderCad(specifications: unknown): boolean;
  meshUrl(partId: string): Promise<{ url: string } | { error: string }>;
  sign(key: string, expiresInSeconds: number): Promise<string>;
  /** Strip a bucket URL down to its object key. */
  extractKey(urlOrKey: string): string;
  drawingRecords(
    partId: string,
  ): Promise<Array<{ attachment: StoredDrawingAttachment | null }>>;
};

export type QuotePartView<P extends PartViewSource> = P & {
  signedMeshUrl: string | undefined;
  signedFileUrl: string | undefined;
  signedThumbnailUrl: string | undefined;
  drawings: SignedDrawing[];
  usesPlaceholderCad: boolean;
};

export async function buildQuotePartView<P extends PartViewSource>(
  part: P,
  ports: PartViewPorts,
): Promise<QuotePartView<P>> {
  const preview = ports.preview(part);
  const usesPlaceholder = ports.usesPlaceholderCad(part.specifications);
  const conversionDone = preview.effectiveConversionStatus === "completed";

  const signSafely = async (key: string, label: string) => {
    try {
      return await ports.sign(key, PART_URL_TTL_SECONDS);
    } catch (error) {
      console.error(`Error getting signed ${label} URL for part`, part.id, ":", error);
      return undefined;
    }
  };

  let signedMeshUrl: string | undefined;
  if (conversionDone && preview.meshKey) {
    const result = await ports.meshUrl(part.id);
    if ("url" in result) signedMeshUrl = result.url;
  }

  // A placeholder part previews the Settings placeholder CAD; any other part its own upload.
  let signedFileUrl: string | undefined;
  if (usesPlaceholder && preview.cadKey && conversionDone) {
    signedFileUrl = await signSafely(ports.extractKey(preview.cadKey), "file");
  } else if (part.partFileUrl) {
    signedFileUrl = await signSafely(ports.extractKey(part.partFileUrl), "file");
  }

  // Thumbnails are stored as bare object keys.
  const signedThumbnailUrl = part.thumbnailUrl
    ? await signSafely(part.thumbnailUrl, "thumbnail")
    : undefined;

  const drawings = await signDrawingAttachments(
    await ports.drawingRecords(part.id),
    ports.sign,
  );

  return {
    ...part,
    signedMeshUrl,
    signedFileUrl,
    signedThumbnailUrl,
    drawings,
    usesPlaceholderCad: usesPlaceholder,
  };
}
