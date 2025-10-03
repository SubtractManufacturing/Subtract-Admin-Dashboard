/**
 * Mesh Converter for Quote Parts
 * Handles conversion of CAD files uploaded to quotes
 */

import { db } from "./db/index.js";
import { quoteParts } from "./db/schema";
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
import { uploadToS3, downloadFromS3 } from "./s3.server";

export interface QuotePartMeshConversionResult {
  success: boolean;
  meshUrl?: string;
  error?: string;
  jobId?: string;
}

/**
 * Convert a BREP file to mesh format for a quote part
 */
export async function convertQuotePartToMesh(
  quotePartId: string,
  brepFileUrl: string
): Promise<QuotePartMeshConversionResult> {
  // Check if conversion is enabled
  if (!isConversionEnabled()) {
    console.log("Mesh conversion service not configured - skipping conversion");
    await updateQuotePartConversionStatus(quotePartId, "skipped");
    return {
      success: false,
      error: "Mesh conversion service not configured",
    };
  }

  try {
    // Update status to queued
    await updateQuotePartConversionStatus(quotePartId, "queued");

    // Extract filename from URL
    const urlParts = brepFileUrl.split("/");
    const filename = urlParts[urlParts.length - 1];

    // Check file format
    const format = detectFileFormat(filename);
    if (format !== "brep") {
      await updateQuotePartConversionStatus(
        quotePartId,
        "failed",
        "File is not a BREP format"
      );
      return {
        success: false,
        error: "File is not a BREP format that requires conversion",
      };
    }

    // Download file from S3
    console.log(`Downloading BREP file for quote part ${quotePartId}`);
    const fileBuffer = await downloadFromS3(brepFileUrl);

    if (!fileBuffer) {
      await updateQuotePartConversionStatus(
        quotePartId,
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
      await updateQuotePartConversionStatus(quotePartId, "failed", sizeCheck.message);
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

    console.log(`Submitting conversion for quote part ${quotePartId}`);
    const conversionJob = await submitConversion(
      fileBuffer,
      filename,
      conversionOptions
    );

    if (!conversionJob) {
      await updateQuotePartConversionStatus(
        quotePartId,
        "failed",
        "Failed to submit conversion job"
      );
      return {
        success: false,
        error: "Failed to submit file for conversion",
      };
    }

    // Update status with job ID
    await updateQuotePartConversionStatus(
      quotePartId,
      "in_progress",
      null,
      conversionJob.job_id
    );

    // Poll for completion
    console.log(`Polling for conversion completion: job ${conversionJob.job_id}`);
    const completedJob = await pollForCompletion(conversionJob.job_id);

    if (!completedJob || completedJob.status === "failed") {
      const error = completedJob?.error || "Conversion failed";
      await updateQuotePartConversionStatus(quotePartId, "failed", error);
      return {
        success: false,
        error,
        jobId: conversionJob.job_id,
      };
    }

    // Download converted file
    console.log(`Downloading converted mesh for job ${conversionJob.job_id}`);
    const result = await downloadConversionResult(conversionJob.job_id);

    if (!result) {
      await updateQuotePartConversionStatus(
        quotePartId,
        "failed",
        "Failed to download converted file"
      );
      return {
        success: false,
        error: "Failed to download converted mesh",
        jobId: conversionJob.job_id,
      };
    }

    // Upload to S3 - sanitize filename to remove spaces and special characters
    const sanitizedFilename = result.filename
      .replace(/\s+/g, '-')  // Replace spaces with hyphens
      .replace(/[^a-zA-Z0-9._-]/g, '');  // Remove any other special characters
    const meshKey = `quote-parts/${quotePartId}/mesh/${sanitizedFilename}`;
    console.log(`Uploading mesh to S3: ${meshKey}`);

    const meshUrl = await uploadToS3(
      result.buffer,
      meshKey,
      getMimeTypeForMesh(result.filename)
    );

    if (!meshUrl) {
      await updateQuotePartConversionStatus(
        quotePartId,
        "failed",
        "Failed to upload mesh to storage"
      );
      return {
        success: false,
        error: "Failed to upload converted mesh to storage",
        jobId: conversionJob.job_id,
      };
    }

    // Update quote part with mesh URL
    await db
      .update(quoteParts)
      .set({
        partMeshUrl: meshUrl,
        conversionStatus: "completed",
        meshConversionCompletedAt: new Date(),
        meshConversionError: null,
      })
      .where(eq(quoteParts.id, quotePartId));

    console.log(`Successfully converted quote part ${quotePartId} to mesh`);
    return {
      success: true,
      meshUrl,
      jobId: conversionJob.job_id,
    };
  } catch (error) {
    console.error(`Error converting quote part ${quotePartId}:`, error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await updateQuotePartConversionStatus(quotePartId, "failed", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Update quote part conversion status in database
 */
async function updateQuotePartConversionStatus(
  quotePartId: string,
  status: "pending" | "queued" | "in_progress" | "completed" | "failed" | "skipped",
  error?: string | null,
  jobId?: string,
  meshUrl?: string
) {
  const updates: {
    conversionStatus: "pending" | "queued" | "in_progress" | "completed" | "failed" | "skipped";
    meshConversionError?: string | null;
    meshConversionJobId?: string;
    partMeshUrl?: string;
    meshConversionStartedAt?: Date;
    meshConversionCompletedAt?: Date;
    updatedAt: Date;
  } = {
    conversionStatus: status,
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

  await db.update(quoteParts).set(updates).where(eq(quoteParts.id, quotePartId));
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
 * Trigger mesh conversion for a quote part if needed
 */
export async function triggerQuotePartMeshConversion(
  quotePartId: string,
  fileUrl: string
) {
  // Check if conversion is enabled
  if (!isConversionEnabled()) {
    console.log("Mesh conversion service not configured - skipping");
    return;
  }

  // Check if file is a BREP format
  const filename = fileUrl.split("/").pop() || "";
  const format = detectFileFormat(filename);

  if (format !== "brep") {
    console.log(`File ${filename} is not a BREP format - skipping conversion`);
    await updateQuotePartConversionStatus(quotePartId, "skipped");
    return;
  }

  // Start conversion asynchronously
  console.log(`Triggering mesh conversion for quote part ${quotePartId}`);
  convertQuotePartToMesh(quotePartId, fileUrl).catch((error) => {
    console.error(`Failed to convert mesh for quote part ${quotePartId}:`, error);
  });
}

/**
 * Get conversion status for a quote part
 */
export async function getQuotePartConversionStatus(quotePartId: string) {
  const [quotePart] = await db
    .select({
      id: quoteParts.id,
      partName: quoteParts.partName,
      partFileUrl: quoteParts.partFileUrl,
      partMeshUrl: quoteParts.partMeshUrl,
      conversionStatus: quoteParts.conversionStatus,
      meshConversionError: quoteParts.meshConversionError,
      meshConversionJobId: quoteParts.meshConversionJobId,
      meshConversionStartedAt: quoteParts.meshConversionStartedAt,
      meshConversionCompletedAt: quoteParts.meshConversionCompletedAt,
    })
    .from(quoteParts)
    .where(eq(quoteParts.id, quotePartId));

  if (!quotePart) {
    return null;
  }

  return {
    part: {
      id: quotePart.id,
      name: quotePart.partName,
      hasModelFile: !!quotePart.partFileUrl,
      hasMeshFile: !!quotePart.partMeshUrl,
      meshUrl: quotePart.partMeshUrl,
    },
    conversion: {
      status: quotePart.conversionStatus,
      error: quotePart.meshConversionError,
      jobId: quotePart.meshConversionJobId,
      startedAt: quotePart.meshConversionStartedAt,
      completedAt: quotePart.meshConversionCompletedAt,
    },
  };
}

/**
 * Get signed URL for quote part mesh file
 */
export async function getQuotePartMeshUrl(quotePartId: string): Promise<{ url: string } | { error: string }> {
  try {
    // Get the quote part from database
    const [quotePart] = await db
      .select({
        id: quoteParts.id,
        partMeshUrl: quoteParts.partMeshUrl,
      })
      .from(quoteParts)
      .where(eq(quoteParts.id, quotePartId));

    if (!quotePart) {
      return { error: "Quote part not found" };
    }

    if (!quotePart.partMeshUrl) {
      return { error: "Quote part has no mesh file" };
    }

    // Import getDownloadUrl here to avoid circular dependencies
    const { getDownloadUrl } = await import("./s3.server.js");

    // Extract the S3 key from the mesh URL
    let key: string;
    const meshUrl = quotePart.partMeshUrl;

    // Handle different URL formats
    if (meshUrl.includes("/storage/v1/")) {
      // Supabase storage URL format
      const urlParts = meshUrl.split("/storage/v1/s3/");
      if (urlParts[1]) {
        const bucketAndKey = urlParts[1];
        // Remove bucket name (testing-bucket/) to get the key
        key = bucketAndKey.replace(/^[^/]+\//, "");
      } else {
        return { error: "Invalid mesh URL format" };
      }
    } else if (meshUrl.includes("quote-parts/") && meshUrl.includes("/mesh/")) {
      // Direct S3 key format
      const urlParts = meshUrl.split("/");
      const quotePartsIndex = urlParts.indexOf("quote-parts");
      if (quotePartsIndex >= 0) {
        key = urlParts.slice(quotePartsIndex).join("/");
      } else {
        key = meshUrl;
      }
    } else {
      // Try to extract key from full URL
      const urlParts = meshUrl.split("/");
      const quotePartsIndex = urlParts.findIndex(p => p === "quote-parts");
      if (quotePartsIndex >= 0) {
        key = urlParts.slice(quotePartsIndex).join("/");
      } else {
        return { error: "Cannot extract key from mesh URL" };
      }
    }

    // Generate a signed URL for the mesh file
    const signedUrl = await getDownloadUrl(key, 3600); // 1 hour expiry

    return { url: signedUrl };
  } catch (error) {
    console.error("Error getting quote part mesh URL:", error);
    return { error: "Failed to generate mesh URL" };
  }
}
