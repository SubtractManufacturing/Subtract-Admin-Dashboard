import { json } from "@remix-run/node";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { uploadFile, getDownloadUrl, uploadToS3 } from "~/lib/s3.server";
import { 
  getBananaModelUrls, 
  setBananaModelUrls
} from "~/lib/developerSettings";
import {
  isConversionEnabled,
  submitConversion,
  pollForCompletion,
  downloadConversionResult,
  detectFileFormat,
  getRecommendedOutputFormat,
  validateFileSize,
} from "~/lib/conversion-service.server";

/**
 * GET - Returns the signed URL for the banana mesh model
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);
  
  // Only dev users can access this
  if (userDetails.role !== "Dev") {
    return json({ error: "Unauthorized" }, { status: 403, headers });
  }

  try {
    const { meshUrl, conversionStatus } = await getBananaModelUrls();
    
    if (!meshUrl) {
      return json({ 
        meshUrl: null, 
        conversionStatus: conversionStatus || "not_uploaded",
        message: "No banana model uploaded" 
      }, { headers });
    }

    // Generate signed URL for the mesh
    const signedUrl = await getDownloadUrl(meshUrl);
    
    return json({ 
      meshUrl: signedUrl, 
      conversionStatus: conversionStatus || "completed" 
    }, { headers });
  } catch (error) {
    console.error("Error getting banana model:", error);
    return json({ error: "Failed to get banana model" }, { status: 500, headers });
  }
}

/**
 * POST - Upload and convert a banana STEP file
 */
export async function action({ request }: ActionFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  
  // Only dev users can upload
  if (userDetails.role !== "Dev") {
    return json({ error: "Unauthorized" }, { status: 403, headers });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return json({ error: "No file provided" }, { status: 400, headers });
    }

    // Validate file type
    const format = detectFileFormat(file.name);
    if (format !== "brep") {
      return json({ 
        error: "Invalid file format. Please upload a STEP (.step, .stp) or IGES (.iges, .igs) file" 
      }, { status: 400, headers });
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate file size
    const sizeCheck = validateFileSize(buffer.length);
    if (!sizeCheck.valid) {
      return json({ error: sizeCheck.message }, { status: 400, headers });
    }

    // Update status to uploading
    await setBananaModelUrls({ conversionStatus: "uploading" }, user.email);

    // Upload CAD file to S3
    const timestamp = Date.now();
    const sanitizedFileName = file.name.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
    const cadKey = `developer/banana/source/${timestamp}-${sanitizedFileName}`;
    
    await uploadFile({
      key: cadKey,
      buffer,
      contentType: "application/octet-stream",
      fileName: sanitizedFileName,
    });

    // Save CAD URL
    await setBananaModelUrls({ 
      cadUrl: cadKey, 
      conversionStatus: "converting" 
    }, user.email);

    // Check if conversion service is available
    if (!isConversionEnabled()) {
      await setBananaModelUrls({ conversionStatus: "conversion_unavailable" }, user.email);
      return json({ 
        success: true, 
        cadUrl: cadKey,
        message: "CAD file uploaded, but conversion service is not available" 
      }, { headers });
    }

    // Submit for conversion
    const conversionOptions = {
      output_format: getRecommendedOutputFormat(),
      deflection: 0.1,
      angular_deflection: 0.5,
      async_processing: true,
    };

    const conversionJob = await submitConversion(buffer, sanitizedFileName, conversionOptions);

    if (!conversionJob) {
      await setBananaModelUrls({ conversionStatus: "conversion_failed" }, user.email);
      return json({ 
        success: false, 
        error: "Failed to submit file for conversion" 
      }, { status: 500, headers });
    }

    // Poll for completion
    const completedJob = await pollForCompletion(conversionJob.job_id);

    if (!completedJob || completedJob.status === "failed") {
      const error = completedJob?.error || "Conversion failed";
      await setBananaModelUrls({ conversionStatus: "conversion_failed" }, user.email);
      return json({ 
        success: false, 
        error: `Conversion failed: ${error}` 
      }, { status: 500, headers });
    }

    // Download converted mesh
    const result = await downloadConversionResult(conversionJob.job_id);

    if (!result) {
      await setBananaModelUrls({ conversionStatus: "conversion_failed" }, user.email);
      return json({ 
        success: false, 
        error: "Failed to download converted mesh" 
      }, { status: 500, headers });
    }

    // Upload mesh to S3
    const sanitizedMeshFilename = result.filename
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "");
    const meshKey = `developer/banana/mesh/${timestamp}-${sanitizedMeshFilename}`;
    
    // Determine content type for mesh
    const meshContentType = result.filename.endsWith(".glb") 
      ? "model/gltf-binary" 
      : result.filename.endsWith(".gltf")
      ? "model/gltf+json"
      : "application/octet-stream";

    const meshUrl = await uploadToS3(result.buffer, meshKey, meshContentType);

    if (!meshUrl) {
      await setBananaModelUrls({ conversionStatus: "upload_failed" }, user.email);
      return json({ 
        success: false, 
        error: "Failed to upload converted mesh" 
      }, { status: 500, headers });
    }

    // Save mesh URL
    await setBananaModelUrls({ 
      meshUrl: meshKey, 
      conversionStatus: "completed" 
    }, user.email);

    return json({ 
      success: true, 
      cadUrl: cadKey,
      meshUrl: meshKey,
      message: "Banana model uploaded and converted successfully" 
    }, { headers });

  } catch (error) {
    console.error("Error uploading banana model:", error);
    await setBananaModelUrls({ conversionStatus: "error" }, user?.email);
    return json({ 
      error: error instanceof Error ? error.message : "Failed to upload banana model" 
    }, { status: 500, headers });
  }
}

