import { json, LoaderFunctionArgs } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { getCadVersions, backfillExistingCadFile } from "~/lib/cadVersions";
import { getDownloadUrl } from "~/lib/s3.server";
import { db } from "~/lib/db";
import { parts } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

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
      if (s3Key.startsWith('/attachments/s3/')) {
        s3Key = s3Key.substring('/attachments/s3/'.length);
      }

      const fileName = s3Key.split('/').pop() || 'original-file';
      
      await backfillExistingCadFile("part", partId, {
        s3Key,
        fileName,
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
    return json({
      error: error instanceof Error ? error.message : "Failed to fetch versions",
    }, { status: 500 });
  }
}
