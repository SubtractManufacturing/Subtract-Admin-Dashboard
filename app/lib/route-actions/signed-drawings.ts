/**
 * Turn stored drawing attachments into the signed-URL shape the detail pages render.
 * Shared by the Quote and Order loaders (previously two copies).
 */

export type StoredDrawingAttachment = {
  id: string;
  fileName: string;
  contentType: string | null;
  fileSize: number | null;
  s3Key: string;
  thumbnailS3Key: string | null;
};

export type SignedDrawing = {
  id: string;
  fileName: string;
  contentType: string | null;
  fileSize: number | null;
  signedUrl: string;
  thumbnailSignedUrl: string | null;
};

export const DRAWING_URL_TTL_SECONDS = 3600;

/**
 * Sign each attachment. A drawing whose file URL cannot be signed is dropped
 * (logged); a failed thumbnail only loses the thumbnail so the UI shows an icon.
 */
export async function signDrawingAttachments(
  records: ReadonlyArray<{ attachment: StoredDrawingAttachment | null }>,
  sign: (key: string, expiresInSeconds: number) => Promise<string>,
): Promise<SignedDrawing[]> {
  const signed = await Promise.all(
    records.map(async ({ attachment }): Promise<SignedDrawing | null> => {
      if (!attachment) return null;
      try {
        const signedUrl = await sign(attachment.s3Key, DRAWING_URL_TTL_SECONDS);

        let thumbnailSignedUrl: string | null = null;
        if (attachment.thumbnailS3Key) {
          try {
            thumbnailSignedUrl = await sign(
              attachment.thumbnailS3Key,
              DRAWING_URL_TTL_SECONDS,
            );
          } catch {
            // Falls back to a file-type icon in the UI.
          }
        }

        return {
          id: attachment.id,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          fileSize: attachment.fileSize,
          signedUrl,
          thumbnailSignedUrl,
        };
      } catch (error) {
        console.error("Error generating signed URL for drawing:", error);
        return null;
      }
    }),
  );
  return signed.filter((d): d is SignedDrawing => d !== null);
}
