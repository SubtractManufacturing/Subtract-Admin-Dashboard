import { json, LoaderFunctionArgs } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { getCadVersions, backfillExistingCadFile } from "~/lib/cadVersions";
import { getDownloadUrl, getFileInfo } from "~/lib/s3.server";
import { db } from "~/lib/db";
import { parts } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Extract the original filename from an S3 key by stripping the timestamp-hash prefix
 * Handles patterns like: 1765909500913-137c241618d7e1dc-P0004.SLDPRT -> P0004.SLDPRT
 */
function extractOriginalFileName(s3Key: string): string {
  const keyFileName = s3Key.split("/").pop() || "original-file";

  // Pattern: timestamp-randomhex-filename (e.g., 1765909500913-137c241618d7e1dc-P0004.SLDPRT)
  // Match: 13+ digits, dash, 16 hex chars, dash, then the actual filename
  const prefixPattern = /^\d{13,}-[a-f0-9]{16}-(.+)$/i;
  const match = keyFileName.match(prefixPattern);

  if (match) {
    return match[1]; // Return the captured filename without prefix
  }

  return keyFileName;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAuth(request);
  const { partId } = params;

  if (!partId) {
    return json({ error: "Part ID is required" }, { status: 400 });
  }

  // Verify part exists
  const [part] = await db
    .select({
      id: parts.id,
      partFileUrl: parts.partFileUrl,
    })
    .from(parts)
    .where(eq(parts.id, partId))
    .limit(1);

  if (!part) {
    return json({ error: "Part not found" }, { status: 404 });
  }

  try {
    // Backfill existing file as v1 if no version history exists
    if (part.partFileUrl) {
      let s3Key = part.partFileUrl;
      // Handle proxy URLs if present
      if (s3Key.startsWith("/attachments/s3/")) {
        s3Key = s3Key.substring("/attachments/s3/".length);
      }

      // Try to get file info from S3 (original filename and size)
      let fileName = extractOriginalFileName(s3Key);
      let fileSize: number | undefined;

      try {
        const fileInfo = await getFileInfo(s3Key);
        // Prefer original filename from S3 metadata if available
        if (
          fileInfo.metadata?.originalFileName ||
          fileInfo.metadata?.originalfilename
        ) {
          fileName =
            fileInfo.metadata.originalFileName ||
            fileInfo.metadata.originalfilename;
        }
        fileSize = fileInfo.contentLength;
      } catch (s3Error) {
        console.warn("Could not fetch file info from S3:", s3Error);
        // Continue with extracted filename from key
      }

      await backfillExistingCadFile("part", partId, {
        s3Key,
        fileName,
        fileSize,
      });
    }

    // Get all versions for this part
    const versions = await getCadVersions("part", partId);

    // Generate signed download URLs for each version
    const versionsWithUrls = await Promise.all(
      versions.map(async (v) => {
        let downloadUrl: string | null = null;
        try {
          downloadUrl = await getDownloadUrl(v.s3Key, 3600);
        } catch (error) {
          console.error(`Failed to generate URL for version ${v.id}:`, error);
        }

        return {
          id: v.id,
          version: v.version,
          isCurrentVersion: v.isCurrentVersion,
          fileName: v.fileName,
          fileSize: v.fileSize,
          contentType: v.contentType,
          uploadedBy: v.uploadedBy,
          uploadedByEmail: v.uploadedByEmail,
          uploadedAt: v.createdAt,
          notes: v.notes,
          downloadUrl,
        };
      })
    );

    return json({ versions: versionsWithUrls });
  } catch (error) {
    console.error("Error fetching CAD versions:", error);
    return json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch versions",
      },
      { status: 500 }
    );
  }
}
