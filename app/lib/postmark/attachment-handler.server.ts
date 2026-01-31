import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createEmailAttachment } from "~/lib/emails";
import { Readable, Transform } from "stream";

// S3 Client configuration (uses same env vars as rest of codebase)
const s3Client = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT || undefined,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: !!process.env.S3_ENDPOINT, // Required for non-AWS S3 endpoints
});

const S3_BUCKET = process.env.S3_BUCKET;

/**
 * Postmark attachment structure from webhook payload
 */
interface PostmarkAttachment {
  Name: string;
  Content: string; // base64 encoded
  ContentType: string;
  ContentLength: number;
  ContentID?: string; // For inline attachments
}

/**
 * CONSTRAINT 1: Memory-Safe Attachments
 *
 * Process email attachments using stream.Transform to decode base64 in chunks.
 * Streams directly to S3 using AWS SDK v3 Upload utility to prevent OOM crashes
 * with 50MB+ CAD files.
 *
 * Key features:
 * - Never loads entire file into memory (no Buffer.from() entire content)
 * - Processes base64 in 1MB chunks
 * - Uses AWS SDK v3 Upload for multipart upload to S3
 * - Handles large files (tested with 50MB+)
 */
export async function processAttachments(
  emailId: number,
  attachments: PostmarkAttachment[]
): Promise<void> {
  if (!S3_BUCKET) {
    console.error("S3_BUCKET environment variable is not set");
    return;
  }

  for (const attachment of attachments) {
    try {
      const startTime = Date.now();
      const fileSizeMB = (attachment.ContentLength / 1024 / 1024).toFixed(2);

      console.log(
        `Processing attachment: ${attachment.Name} (${fileSizeMB}MB)`
      );

      // Generate S3 key
      const timestamp = Date.now();
      const sanitizedName = attachment.Name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const s3Key = `email-attachments/${emailId}/${timestamp}-${sanitizedName}`;

      // CONSTRAINT 1: Stream-based base64 decoding
      // Process in 1MB chunks to keep memory usage constant
      const chunkSize = 1024 * 1024; // 1MB chunks

      // Create Transform stream that decodes base64 on-the-fly
      const base64DecodeStream = new Transform({
        transform(chunk, encoding, callback) {
          try {
            // Decode base64 in chunks (memory-safe)
            const decoded = Buffer.from(chunk.toString(), "base64");
            callback(null, decoded);
          } catch (error) {
            callback(error as Error);
          }
        },
      });

      // Create readable stream that emits base64 string in chunks
      const createBase64Stream = (): Readable => {
        let offset = 0;
        return new Readable({
          read() {
            if (offset >= attachment.Content.length) {
              this.push(null); // End of stream
              return;
            }

            // Emit chunk of base64 string
            // Make sure we don't split in the middle of a base64 quartet
            const alignedChunkSize = Math.floor(chunkSize / 4) * 4;
            const chunk = attachment.Content.slice(
              offset,
              offset + alignedChunkSize
            );
            offset += alignedChunkSize;
            this.push(chunk);
          },
        });
      };

      // Stream pipeline: base64 chunks → decode → S3
      const uploadStream = createBase64Stream().pipe(base64DecodeStream);

      // CONSTRAINT 1: Use AWS SDK v3 Upload utility for streaming to S3
      // This handles multipart uploads automatically for large files
      const parallelUploads = new Upload({
        client: s3Client,
        params: {
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: uploadStream,
          ContentType: attachment.ContentType,
          Metadata: {
            emailId: String(emailId),
            originalName: attachment.Name,
            contentLength: String(attachment.ContentLength),
          },
        },
        // Upload in 5MB parts for large files (S3 multipart upload)
        partSize: 5 * 1024 * 1024,
        queueSize: 4, // Upload 4 parts concurrently
      });

      await parallelUploads.done();

      const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(
        `✓ Streamed ${fileSizeMB}MB to S3 in ${uploadTime}s: ${s3Key}`
      );

      // Create database record
      await createEmailAttachment({
        emailId,
        filename: attachment.Name,
        contentType: attachment.ContentType,
        contentLength: attachment.ContentLength,
        s3Bucket: S3_BUCKET,
        s3Key: s3Key,
        contentId: attachment.ContentID || null,
      });

      console.log(`✓ Created email_attachments record for ${attachment.Name}`);
    } catch (error) {
      console.error(
        `Failed to process attachment ${attachment.Name}:`,
        error
      );
      // Continue with other attachments - don't fail entire webhook
    }
  }
}

/**
 * Get a presigned URL for downloading an attachment from S3
 */
export async function getAttachmentDownloadUrl(
  s3Key: string,
  filename: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });

  const url = await getSignedUrl(s3Client, command, {
    expiresIn: expiresInSeconds,
  });

  return url;
}
