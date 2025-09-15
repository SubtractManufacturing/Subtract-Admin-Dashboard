/**
 * Mesh Converter Utilities
 * High-level functions for converting BREP files to mesh formats
 */

import { db } from "./db/index.js";
import { parts } from "./db/schema";
import { eq, count } from "drizzle-orm";
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
import { uploadToS3, downloadFromS3 } from "./s3.server";

export interface MeshConversionResult {
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
): Promise<MeshConversionResult> {
  // Check if conversion is enabled
  if (!isConversionEnabled()) {
    console.log("Mesh conversion service not configured - skipping conversion");
    await updatePartConversionStatus(partId, "skipped");
    return { 
      success: false, 
      error: "Mesh conversion service not configured" 
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
      await updatePartConversionStatus(partId, "failed", "File is not a BREP format");
      return { 
        success: false, 
        error: "File is not a BREP format that requires conversion" 
      };
    }

    // Download file from S3
    console.log(`Downloading BREP file for part ${partId}`);
    const fileBuffer = await downloadFromS3(brepFileUrl);
    
    if (!fileBuffer) {
      await updatePartConversionStatus(partId, "failed", "Failed to download file from S3");
      return { 
        success: false, 
        error: "Failed to download file from storage" 
      };
    }

    // Validate file size
    const sizeCheck = validateFileSize(fileBuffer.length);
    if (!sizeCheck.valid) {
      await updatePartConversionStatus(partId, "failed", sizeCheck.message);
      return { 
        success: false, 
        error: sizeCheck.message 
      };
    }

    // Submit for conversion
    const conversionOptions: ConversionOptions = {
      output_format: getRecommendedOutputFormat(),
      deflection: 0.1, // Good balance of quality and file size
      angular_deflection: 0.5,
      async_processing: true, // Always use async for better UX
    };

    console.log(`Submitting conversion for part ${partId}`);
    const conversionJob = await submitConversion(
      fileBuffer,
      filename,
      conversionOptions
    );

    if (!conversionJob) {
      await updatePartConversionStatus(partId, "failed", "Failed to submit conversion job");
      return { 
        success: false, 
        error: "Failed to submit file for conversion" 
      };
    }

    // Update status with job ID
    await updatePartConversionStatus(partId, "in_progress", null, conversionJob.job_id);

    // Poll for completion
    console.log(`Polling for conversion completion: job ${conversionJob.job_id}`);
    const completedJob = await pollForCompletion(conversionJob.job_id);

    if (!completedJob || completedJob.status === "failed") {
      const error = completedJob?.error || "Conversion failed";
      await updatePartConversionStatus(partId, "failed", error);
      return { 
        success: false, 
        error,
        jobId: conversionJob.job_id 
      };
    }

    // Download converted file
    console.log(`Downloading converted mesh for job ${conversionJob.job_id}`);
    const result = await downloadConversionResult(conversionJob.job_id);
    
    if (!result) {
      await updatePartConversionStatus(partId, "failed", "Failed to download converted file");
      return { 
        success: false, 
        error: "Failed to download converted mesh",
        jobId: conversionJob.job_id 
      };
    }

    // Upload to S3
    const meshKey = `parts/${partId}/mesh/${result.filename}`;
    console.log(`Uploading mesh to S3: ${meshKey}`);
    
    const meshUrl = await uploadToS3(
      result.buffer,
      meshKey,
      getMimeTypeForMesh(result.filename)
    );

    if (!meshUrl) {
      await updatePartConversionStatus(partId, "failed", "Failed to upload mesh to storage");
      return { 
        success: false, 
        error: "Failed to upload converted mesh to storage",
        jobId: conversionJob.job_id 
      };
    }

    // Update part with mesh URL
    await db.update(parts)
      .set({
        partMeshUrl: meshUrl,
        meshConversionStatus: "completed",
        meshConversionCompletedAt: new Date(),
        meshConversionError: null,
      })
      .where(eq(parts.id, partId));

    console.log(`Successfully converted part ${partId} to mesh`);
    return { 
      success: true, 
      meshUrl,
      jobId: conversionJob.job_id 
    };

  } catch (error) {
    console.error(`Error converting part ${partId}:`, error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await updatePartConversionStatus(partId, "failed", errorMessage);
    return { 
      success: false, 
      error: errorMessage 
    };
  }
}

/**
 * Update part conversion status in database
 */
async function updatePartConversionStatus(
  partId: string,
  status: string,
  error?: string | null,
  jobId?: string,
  meshUrl?: string
) {
  const updates: {
    meshConversionStatus: string;
    meshConversionError?: string | null;
    meshConversionJobId?: string;
    partMeshUrl?: string;
    meshConversionStartedAt?: Date;
    meshConversionCompletedAt?: Date;
  } = {
    meshConversionStatus: status,
    meshConversionError: error,
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

  await db.update(parts)
    .set(updates)
    .where(eq(parts.id, partId));
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
 * Retry failed conversions for a part
 */
export async function retryPartConversion(partId: string): Promise<MeshConversionResult> {
  // Get part details
  const [part] = await db.select()
    .from(parts)
    .where(eq(parts.id, partId));

  if (!part) {
    return { 
      success: false, 
      error: "Part not found" 
    };
  }

  if (!part.partFileUrl) {
    return { 
      success: false, 
      error: "Part has no BREP file to convert" 
    };
  }

  // Reset status and retry
  await updatePartConversionStatus(partId, "pending");
  return convertPartToMesh(partId, part.partFileUrl);
}

/**
 * Batch convert multiple parts
 */
export async function batchConvertParts(
  partIds: string[]
): Promise<Map<string, MeshConversionResult>> {
  const results = new Map<string, MeshConversionResult>();
  
  // Process conversions in parallel with a limit
  const BATCH_SIZE = 3; // Process 3 at a time to avoid overwhelming the service
  
  for (let i = 0; i < partIds.length; i += BATCH_SIZE) {
    const batch = partIds.slice(i, i + BATCH_SIZE);
    
    const batchPromises = batch.map(async (partId) => {
      // Get part details
      const [part] = await db.select()
        .from(parts)
        .where(eq(parts.id, partId));

      if (!part || !part.partFileUrl) {
        return { 
          partId, 
          result: { 
            success: false, 
            error: "Part not found or has no BREP file" 
          } 
        };
      }

      const result = await convertPartToMesh(partId, part.partFileUrl);
      return { partId, result };
    });

    const batchResults = await Promise.all(batchPromises);
    
    for (const { partId, result } of batchResults) {
      results.set(partId, result);
    }
  }

  return results;
}

/**
 * Get conversion statistics
 */
export async function getConversionStats() {
  const stats = await db.select({
    status: parts.meshConversionStatus,
    count: count(),
  })
  .from(parts)
  .groupBy(parts.meshConversionStatus);

  return stats.reduce((acc: Record<string, number>, { status, count }: { status: string | null, count: number }) => {
    if (status) {
      acc[status] = count;
    }
    return acc;
  }, {} as Record<string, number>);
}

/**
 * Find parts that need conversion
 */
export async function findPartsNeedingConversion() {
  return await db.select()
    .from(parts)
    .where(eq(parts.meshConversionStatus, "pending"))
    .limit(10); // Process in batches
}