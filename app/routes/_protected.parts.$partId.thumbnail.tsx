import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { updatePart, getPart } from "~/lib/parts";
import { uploadFile, deleteFile } from "~/lib/s3.server";
import { createAttachment, deleteAttachmentByS3Key } from "~/lib/attachments";
import { requireAuth } from "~/lib/auth.server";

export async function action({ request, params }: ActionFunctionArgs) {
  const { headers } = await requireAuth(request);
  
  const partId = params.partId;
  if (!partId) {
    return json({ error: "Part ID is required" }, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return json({ error: "No file provided" }, { status: 400 });
    }

    // Get the existing part to check for old thumbnail
    const existingPart = await getPart(partId);
    
    // If there's an existing thumbnail, extract the S3 key from the URL
    let oldS3Key: string | null = null;
    if (existingPart?.thumbnailUrl) {
      // Extract S3 key from the signed URL
      // The thumbnailUrl might be a signed URL like: https://s3.amazonaws.com/bucket/part-thumbnails/...
      // Or it might contain the key in query params
      try {
        const url = new URL(existingPart.thumbnailUrl);
        // Try to extract the key from the pathname
        const pathParts = url.pathname.split('/');
        // Remove bucket name if it's in the path
        const keyStartIndex = pathParts.findIndex(part => part === 'part-thumbnails');
        if (keyStartIndex !== -1) {
          oldS3Key = pathParts.slice(keyStartIndex).join('/');
        }
      } catch (e) {
        // If URL parsing fails, try to find the key pattern directly
        const match = existingPart.thumbnailUrl.match(/part-thumbnails\/[^?]+/);
        if (match) {
          oldS3Key = match[0];
        }
      }
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate S3 key for the thumbnail
    const timestamp = Date.now();
    const key = `part-thumbnails/${partId}/${timestamp}-thumbnail.png`;

    // Upload to S3
    const uploadResult = await uploadFile({
      key,
      buffer,
      contentType: file.type || 'image/png',
      fileName: `${partId}-thumbnail.png`
    });

    // Create attachment record
    await createAttachment({
      fileName: uploadResult.fileName,
      fileSize: uploadResult.size,
      contentType: uploadResult.contentType,
      s3Key: uploadResult.key,
      s3Bucket: uploadResult.bucket,
    });

    // Store just the S3 key (not a signed URL that expires)
    // Loaders will generate signed URLs on-demand
    await updatePart(partId, { thumbnailUrl: uploadResult.key });

    // After successful upload and update, delete the old thumbnail if it exists
    if (oldS3Key) {
      try {
        // Delete from S3
        await deleteFile(oldS3Key);
        
        // Also delete the old attachment record from database
        await deleteAttachmentByS3Key(oldS3Key);
        
        console.log(`Deleted old thumbnail from S3 and database: ${oldS3Key}`);
      } catch (error) {
        // Log but don't fail if cleanup fails
        console.error(`Failed to delete old thumbnail: ${oldS3Key}`, error);
      }
    }

    return json({ thumbnailUrl: uploadResult.key, success: true }, { headers });
  } catch (error) {
    console.error("Error uploading thumbnail:", error);
    return json({ error: "Failed to upload thumbnail" }, { status: 500 });
  }
}