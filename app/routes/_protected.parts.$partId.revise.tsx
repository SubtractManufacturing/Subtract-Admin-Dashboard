import {
  json,
  ActionFunctionArgs,
  unstable_parseMultipartFormData,
  unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { canUserUploadCadRevision } from "~/lib/featureFlags";
import { createCadVersion, getLatestVersionNumber, backfillExistingCadFile } from "~/lib/cadVersions";
import { handlePartCadRevision } from "~/lib/part-mesh-converter.server";
import { uploadFile } from "~/lib/s3.server";
import { createEvent } from "~/lib/events";
import { db } from "~/lib/db";
import { parts } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function action({ request, params }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);
  const { partId } = params;

  if (!partId) {
    return json({ error: "Part ID is required" }, { status: 400 });
  }

  if (!user?.id) {
    return json({ error: "User authentication failed" }, { status: 401 });
  }

  // Feature flag check
  const canRevise = await canUserUploadCadRevision(userDetails?.role);
  if (!canRevise) {
    return json({ error: "CAD revisions are not enabled for your account" }, { status: 403 });
  }

  // Verify part exists and get customer ID and existing file info for event logging
  const [part] = await db
    .select({
      id: parts.id,
      partName: parts.partName,
      customerId: parts.customerId,
      partFileUrl: parts.partFileUrl,
    })
    .from(parts)
    .where(eq(parts.id, partId))
    .limit(1);

  if (!part) {
    return json({ error: "Part not found" }, { status: 404 });
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
    if (part.partFileUrl) {
      const existingFileName = part.partFileUrl.split("/").pop() || "original-file";
      await backfillExistingCadFile("part", partId, {
        s3Key: part.partFileUrl,
        fileName: existingFileName,
      });
    }

    // Determine next version number (will be 2 if backfill created v1, or 1 if no existing file)
    const currentVersionNumber = await getLatestVersionNumber("part", partId);
    const nextVersion = currentVersionNumber + 1;

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Sanitize filename for S3
    const sanitizedFileName = file.name
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "");

    // Upload to versioned S3 path
    const s3Key = `parts/${partId}/source/v${nextVersion}/${sanitizedFileName}`;
    await uploadFile({
      key: s3Key,
      buffer,
      contentType: file.type || "application/octet-stream",
      fileName: sanitizedFileName,
    });

    // Create version record
    const version = await createCadVersion(
      "part",
      partId,
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

    if (!version) {
      return json({ error: "Failed to create version record" }, { status: 500 });
    }

    // Handle revision workflow (delete old mesh, update CAD URL, trigger conversion)
    await handlePartCadRevision(
      partId,
      s3Key,
      user.id,
      user.email || userDetails?.name || "unknown"
    );

    // Log event on part
    await createEvent({
      entityType: "part",
      entityId: partId,
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

    // Also log event on customer for visibility
    if (part.customerId) {
      await createEvent({
        entityType: "customer",
        entityId: part.customerId.toString(),
        eventType: "cad_revision_uploaded",
        eventCategory: "document",
        title: `CAD revised: ${part.partName || "Part"}`,
        description: `Uploaded v${nextVersion}: ${file.name}`,
        metadata: {
          partId,
          partName: part.partName,
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
