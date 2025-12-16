import {
  json,
  ActionFunctionArgs,
  unstable_parseMultipartFormData,
  unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { createCadVersion, getLatestVersionNumber, backfillExistingCadFile } from "~/lib/cadVersions";
import { handleCadRevision } from "~/lib/quote-part-mesh-converter.server";
import { uploadFile } from "~/lib/s3.server";
import { createEvent } from "~/lib/events";
import { db } from "~/lib/db";
import { quoteParts } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function action({ request, params }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);
  const { quotePartId } = params;

  if (!quotePartId) {
    return json({ error: "Quote Part ID is required" }, { status: 400 });
  }

  // Verify quote part exists and get quote ID and existing file info for event logging
  const [quotePart] = await db
    .select({
      id: quoteParts.id,
      partName: quoteParts.partName,
      quoteId: quoteParts.quoteId,
      partFileUrl: quoteParts.partFileUrl,
    })
    .from(quoteParts)
    .where(eq(quoteParts.id, quotePartId))
    .limit(1);

  if (!quotePart) {
    return json({ error: "Quote part not found" }, { status: 404 });
  }

  try {
    // Parse multipart form data
    const uploadHandler = unstable_createMemoryUploadHandler({
      maxPartSize: MAX_FILE_SIZE,
    });

    const formData = await unstable_parseMultipartFormData(request, uploadHandler);
    const file = formData.get("file") as File | null;
    const notes = formData.get("notes") as string | null;

    if (!file || file.size === 0) {
      return json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const allowedExtensions = [".step", ".stp", ".iges", ".igs", ".brep"];
    const fileExtension = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!allowedExtensions.includes(fileExtension)) {
      return json({
        error: `Invalid file type. Allowed types: ${allowedExtensions.join(", ")}`,
      }, { status: 400 });
    }

    // Backfill existing file as v1 if no version history exists
    // This preserves files uploaded before version history was implemented
    if (quotePart.partFileUrl) {
      const existingFileName = quotePart.partFileUrl.split("/").pop() || "original-file";
      await backfillExistingCadFile("quote_part", quotePartId, {
        s3Key: quotePart.partFileUrl,
        fileName: existingFileName,
      });
    }

    // Determine next version number (will be 2 if backfill created v1, or 1 if no existing file)
    const currentVersionNumber = await getLatestVersionNumber("quote_part", quotePartId);
    const nextVersion = currentVersionNumber + 1;

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Sanitize filename for S3
    const sanitizedFileName = file.name
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "");

    // Upload to versioned S3 path
    const s3Key = `quote-parts/${quotePartId}/source/v${nextVersion}/${sanitizedFileName}`;
    await uploadFile({
      key: s3Key,
      buffer,
      contentType: file.type || "application/octet-stream",
      fileName: sanitizedFileName,
    });

    // Create version record
    const version = await createCadVersion(
      "quote_part",
      quotePartId,
      {
        s3Key,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || "application/octet-stream",
      },
      user.id,
      user.email || userDetails?.name || "unknown",
      notes || undefined
    );

    // Handle revision workflow (delete old mesh, update CAD URL, trigger conversion)
    await handleCadRevision(
      quotePartId,
      s3Key,
      user.id,
      user.email || userDetails?.name || "unknown"
    );

    // Log event on quote_part
    await createEvent({
      entityType: "quote_part",
      entityId: quotePartId,
      eventType: "cad_revision_uploaded",
      eventCategory: "document",
      title: `CAD file revised to v${nextVersion}`,
      description: `Uploaded new revision: ${file.name}`,
      metadata: {
        version: nextVersion,
        fileName: file.name,
        fileSize: file.size,
        notes: notes || undefined,
      },
      userId: user.id,
      userEmail: user.email || userDetails?.name || undefined,
    });

    // Also log event on parent quote for visibility in quote timeline
    if (quotePart.quoteId) {
      await createEvent({
        entityType: "quote",
        entityId: quotePart.quoteId.toString(),
        eventType: "cad_revision_uploaded",
        eventCategory: "document",
        title: `CAD revised: ${quotePart.partName || "Part"}`,
        description: `Uploaded v${nextVersion}: ${file.name}`,
        metadata: {
          quotePartId,
          partName: quotePart.partName,
          version: nextVersion,
          fileName: file.name,
        },
        userId: user.id,
        userEmail: user.email || userDetails?.name || undefined,
      });
    }

    return json({
      success: true,
      version: nextVersion,
      versionId: version.id,
    });
  } catch (error) {
    console.error("Error uploading CAD revision:", error);
    return json({
      error: error instanceof Error ? error.message : "Failed to upload revision",
    }, { status: 500 });
  }
}
