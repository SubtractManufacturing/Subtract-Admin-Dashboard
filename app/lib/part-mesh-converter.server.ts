/**
 * Mesh Converter for Customer Parts
 * Handles conversion of CAD files on customer parts (used in orders)
 */

import { db } from "./db/index.js";
import { parts } from "./db/schema";
import { eq } from "drizzle-orm";
import {
  submitConversion,
  pollForCompletion,
  downloadConversionResult,
  detectFileFormat,
  getRecommendedOutputFormat,
  validateFileSize,
  isConversionEnabled,
  type ConversionOptions,
} from "./conversion-service.server";
import { uploadToS3, downloadFromS3, deleteFile, getDownloadUrl } from "./s3.server";
import { createEvent } from "./events";

export interface PartMeshConversionResult {
  success: boolean;
  meshUrl?: string;
  error?: string;
  jobId?: string;
}

/**
 * Convert a BREP file to mesh format for a part
 */
export async function convertPartToMesh(
  partId: string,
  brepFileUrl: string
): Promise<PartMeshConversionResult> {
  // Check if conversion is enabled
  if (!isConversionEnabled()) {
    await updatePartConversionStatus(partId, "skipped");
    return {
      success: false,
      error: "Mesh conversion service not configured",
    };
  }

  try {
    // Update status to queued
    await updatePartConversionStatus(partId, "queued");

    // Extract filename from URL
    const urlParts = brepFileUrl.split("/");
    const filename = urlParts[urlParts.length - 1];

    // Check file format
    const format = detectFileFormat(filename);
    if (format !== "brep") {
      await updatePartConversionStatus(
        partId,
        "failed",
        "File is not a BREP format"
      );
      return {
        success: false,
        error: "File is not a BREP format that requires conversion",
      };
    }

    // Download file from S3
    const fileBuffer = await downloadFromS3(brepFileUrl);

    if (!fileBuffer) {
      await updatePartConversionStatus(
        partId,
        "failed",
        "Failed to download file from S3"
      );
      return {
        success: false,
        error: "Failed to download file from storage",
      };
    }

    // Validate file size
    const sizeCheck = validateFileSize(fileBuffer.length);
    if (!sizeCheck.valid) {
      await updatePartConversionStatus(partId, "failed", sizeCheck.message);
      return {
        success: false,
        error: sizeCheck.message,
      };
    }

    // Submit for conversion
    const conversionOptions: ConversionOptions = {
      output_format: getRecommendedOutputFormat(),
      deflection: 0.1,
      angular_deflection: 0.5,
      async_processing: true,
    };

    const conversionJob = await submitConversion(
      fileBuffer,
      filename,
      conversionOptions
    );

    if (!conversionJob) {
      await updatePartConversionStatus(
        partId,
        "failed",
        "Failed to submit conversion job"
      );
      return {
        success: false,
        error: "Failed to submit file for conversion",
      };
    }

    // Update status with job ID
    await updatePartConversionStatus(
      partId,
      "in_progress",
      null,
      conversionJob.job_id
    );

    // Poll for completion
    const completedJob = await pollForCompletion(conversionJob.job_id);

    if (!completedJob || completedJob.status === "failed") {
      const error = completedJob?.error || "Conversion failed";
      await updatePartConversionStatus(partId, "failed", error);
      return {
        success: false,
        error,
        jobId: conversionJob.job_id,
      };
    }

    // Download converted file
    const result = await downloadConversionResult(conversionJob.job_id);

    if (!result) {
      await updatePartConversionStatus(
        partId,
        "failed",
        "Failed to download converted file"
      );
      return {
        success: false,
        error: "Failed to download converted mesh",
        jobId: conversionJob.job_id,
      };
    }

    // Upload to S3 - sanitize filename
    const sanitizedFilename = result.filename
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    const meshKey = `parts/${partId}/mesh/${sanitizedFilename}`;

    const meshUrl = await uploadToS3(
      result.buffer,
      meshKey,
      getMimeTypeForMesh(result.filename)
    );

    if (!meshUrl) {
      await updatePartConversionStatus(
        partId,
        "failed",
        "Failed to upload mesh to storage"
      );
      return {
        success: false,
        error: "Failed to upload converted mesh to storage",
        jobId: conversionJob.job_id,
      };
    }

    // Update part with mesh URL
    await db
      .update(parts)
      .set({
        partMeshUrl: meshUrl,
        meshConversionStatus: "completed",
        meshConversionCompletedAt: new Date(),
        meshConversionError: null,
      })
      .where(eq(parts.id, partId));

    return {
      success: true,
      meshUrl,
      jobId: conversionJob.job_id,
    };
  } catch (error) {
    console.error(`Error converting part ${partId}:`, error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await updatePartConversionStatus(partId, "failed", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Update part conversion status in database
 */
async function updatePartConversionStatus(
  partId: string,
  status: "pending" | "queued" | "in_progress" | "completed" | "failed" | "skipped",
  error?: string | null,
  jobId?: string,
  meshUrl?: string
) {
  const updates: {
    meshConversionStatus: "pending" | "queued" | "in_progress" | "completed" | "failed" | "skipped";
    meshConversionError?: string | null;
    meshConversionJobId?: string;
    partMeshUrl?: string;
    meshConversionStartedAt?: Date;
    meshConversionCompletedAt?: Date;
    updatedAt: Date;
  } = {
    meshConversionStatus: status,
    meshConversionError: error,
    updatedAt: new Date(),
  };

  if (jobId) {
    updates.meshConversionJobId = jobId;
  }

  if (meshUrl) {
    updates.partMeshUrl = meshUrl;
  }

  if (status === "in_progress" || status === "queued") {
    updates.meshConversionStartedAt = new Date();
  }

  if (status === "completed" || status === "failed") {
    updates.meshConversionCompletedAt = new Date();
  }

  await db.update(parts).set(updates).where(eq(parts.id, partId));
}

/**
 * Get MIME type for mesh file
 */
function getMimeTypeForMesh(filename: string): string {
  const extension = filename.toLowerCase().split(".").pop();

  switch (extension) {
    case "glb":
      return "model/gltf-binary";
    case "gltf":
      return "model/gltf+json";
    case "obj":
      return "model/obj";
    case "stl":
      return "model/stl";
    default:
      return "application/octet-stream";
  }
}

/**
 * Trigger mesh conversion for a part if needed
 */
export async function triggerPartMeshConversion(
  partId: string,
  fileUrl: string
) {
  // Check if conversion is enabled
  if (!isConversionEnabled()) {
    return;
  }

  // Check if file is a BREP format
  const filename = fileUrl.split("/").pop() || "";
  const format = detectFileFormat(filename);

  if (format !== "brep") {
    await updatePartConversionStatus(partId, "skipped");
    return;
  }

  // Start conversion asynchronously
  convertPartToMesh(partId, fileUrl).catch((error) => {
    console.error(`Failed to convert mesh for part ${partId}:`, error);
  });
}

/**
 * Get signed URL for part mesh file
 */
export async function getPartMeshUrl(partId: string): Promise<{ url: string } | { error: string }> {
  try {
    const [part] = await db
      .select({
        id: parts.id,
        partMeshUrl: parts.partMeshUrl,
      })
      .from(parts)
      .where(eq(parts.id, partId));

    if (!part) {
      return { error: "Part not found" };
    }

    if (!part.partMeshUrl) {
      return { error: "Part has no mesh file" };
    }

    const key = extractS3Key(part.partMeshUrl);
    const signedUrl = await getDownloadUrl(key, 3600);

    return { url: signedUrl };
  } catch (error) {
    console.error("Error getting part mesh URL:", error);
    return { error: "Failed to generate mesh URL" };
  }
}

/**
 * Extract S3 key from a URL or key string
 */
function extractS3Key(urlOrKey: string): string {
  if (urlOrKey.startsWith("parts/") || urlOrKey.startsWith("quote-parts/")) {
    return urlOrKey;
  }

  const urlParts = urlOrKey.split("/");
  const partsIndex = urlParts.findIndex(p => p === "parts" || p === "quote-parts");
  if (partsIndex >= 0) {
    return urlParts.slice(partsIndex).join("/");
  }

  return urlOrKey;
}

/**
 * Delete existing mesh and thumbnail for a part
 */
export async function deletePartMesh(
  partId: string,
  userId: string,
  userEmail: string,
  reason: "revision" | "restore"
): Promise<void> {
  const [part] = await db
    .select({
      partMeshUrl: parts.partMeshUrl,
      thumbnailUrl: parts.thumbnailUrl,
    })
    .from(parts)
    .where(eq(parts.id, partId));

  if (!part?.partMeshUrl && !part?.thumbnailUrl) return;

  // Delete mesh from S3
  if (part.partMeshUrl) {
    const meshKey = extractS3Key(part.partMeshUrl);
    try {
      await deleteFile(meshKey);
    } catch (error) {
      console.error(`Failed to delete mesh file ${meshKey}:`, error);
    }
  }

  // Delete thumbnail from S3
  if (part.thumbnailUrl) {
    const thumbnailKey = extractS3Key(part.thumbnailUrl);
    try {
      await deleteFile(thumbnailKey);
    } catch (error) {
      console.error(`Failed to delete thumbnail file ${thumbnailKey}:`, error);
    }
  }

  // Clear mesh and thumbnail URLs in database
  await db
    .update(parts)
    .set({
      partMeshUrl: null,
      thumbnailUrl: null,
      meshConversionStatus: "pending",
      meshConversionError: null,
      meshConversionJobId: null,
      updatedAt: new Date(),
    })
    .where(eq(parts.id, partId));

  // Log event
  await createEvent({
    entityType: "part",
    entityId: partId,
    eventType: "cad_mesh_deleted",
    eventCategory: "document",
    title: "Mesh and thumbnail deleted",
    description: `Previous mesh and thumbnail deleted due to ${reason}`,
    metadata: {
      previousMeshUrl: part.partMeshUrl,
      previousThumbnailUrl: part.thumbnailUrl,
      reason
    },
    userId,
    userEmail,
  });
}

/**
 * Full revision workflow for parts
 */
export async function handlePartCadRevision(
  partId: string,
  newCadS3Key: string,
  userId: string,
  userEmail: string
): Promise<void> {
  await deletePartMesh(partId, userId, userEmail, "revision");

  await db
    .update(parts)
    .set({
      partFileUrl: newCadS3Key,
      meshConversionStatus: "pending",
      updatedAt: new Date(),
    })
    .where(eq(parts.id, partId));

  await triggerPartMeshConversion(partId, newCadS3Key);
}

/**
 * Restore version workflow for parts
 */
export async function handlePartVersionRestore(
  partId: string,
  restoredVersionS3Key: string,
  userId: string,
  userEmail: string
): Promise<void> {
  await deletePartMesh(partId, userId, userEmail, "restore");

  await db
    .update(parts)
    .set({
      partFileUrl: restoredVersionS3Key,
      meshConversionStatus: "pending",
      updatedAt: new Date(),
    })
    .where(eq(parts.id, partId));

  await triggerPartMeshConversion(partId, restoredVersionS3Key);
}

/**
 * Get signed download URL for part CAD file
 */
export async function getPartCadUrl(partId: string): Promise<{ url: string } | { error: string }> {
  try {
    const [part] = await db
      .select({
        id: parts.id,
        partFileUrl: parts.partFileUrl,
      })
      .from(parts)
      .where(eq(parts.id, partId));

    if (!part) {
      return { error: "Part not found" };
    }

    if (!part.partFileUrl) {
      return { error: "Part has no CAD file" };
    }

    const key = extractS3Key(part.partFileUrl);
    const signedUrl = await getDownloadUrl(key, 3600);

    return { url: signedUrl };
  } catch (error) {
    console.error("Error getting part CAD URL:", error);
    return { error: "Failed to generate CAD URL" };
  }
}
