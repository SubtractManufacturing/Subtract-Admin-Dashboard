import { db } from "./db";
import { quotes, quoteParts, quotePartDrawings, attachments } from "./db/schema";
import { eq } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "./s3.server";
import archiver from "archiver";

interface FileToZip {
  buffer: Buffer;
  path: string;
}

/**
 * Extract S3 key from a URL or return the string as-is if it's already a key
 */
function extractS3Key(urlOrKey: string): string {
  // If it's already a key (doesn't start with http), return as-is
  if (!urlOrKey.startsWith('http')) {
    return urlOrKey;
  }

  // Extract key from URL
  const S3_BUCKET = process.env.S3_BUCKET || 'subtract-attachments';

  if (urlOrKey.includes(S3_BUCKET)) {
    // URL contains bucket name, extract key after it
    const parts = urlOrKey.split(`${S3_BUCKET}/`);
    return parts[1] || urlOrKey;
  } else {
    // Assume the URL is just the key or a partial path
    const urlParts = urlOrKey.split('/');
    // Remove protocol and domain if present
    const startIdx = urlParts.findIndex(part => part.includes('quote-parts') || part.includes('orders'));
    return startIdx >= 0 ? urlParts.slice(startIdx).join('/') : urlOrKey;
  }
}

export async function downloadQuoteFiles(quoteId: number) {
  const s3Client = getS3Client();

  // Get the quote
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);

  if (!quote) {
    console.error("[downloadQuoteFiles] Quote not found:", quoteId);
    throw new Error("Quote not found");
  }

  // Get all parts for this quote
  const parts = await db
    .select()
    .from(quoteParts)
    .where(eq(quoteParts.quoteId, quoteId));

  if (parts.length === 0) {
    throw new Error("No parts found for this quote");
  }

  // Get all drawings for these parts
  const partIds = parts.map((p) => p.id);

  // Get quote part drawings with their attachments
  const drawingsData: Array<{
    quotePartId: string;
    attachment: typeof attachments.$inferSelect;
  }> = [];

  for (const partId of partIds) {
    const drawings = await db
      .select()
      .from(quotePartDrawings)
      .innerJoin(attachments, eq(quotePartDrawings.attachmentId, attachments.id))
      .where(eq(quotePartDrawings.quotePartId, partId));

    for (const drawing of drawings) {
      drawingsData.push({
        quotePartId: partId,
        attachment: drawing.attachments,
      });
    }
  }

  // Download all files first (in parallel)
  const filesToZip: FileToZip[] = [];
  const downloadPromises: Promise<void>[] = [];

  for (const part of parts) {
    // Create a clean folder name for each part
    const sanitizedPartName = (part.partName || part.partNumber || "Unnamed Part")
      .replace(/[^a-zA-Z0-9-_ ]/g, "_");
    const partFolder = `${sanitizedPartName}/`;

    // Download part 3D model file (STEP/CAD file) if exists
    if (part.partFileUrl) {
      downloadPromises.push(
        (async () => {
          try {
            const s3Key = extractS3Key(part.partFileUrl!);
            const command = new GetObjectCommand({
              Bucket: process.env.S3_BUCKET!,
              Key: s3Key,
            });
            const response = await s3Client.send(command);

            if (response.Body) {
              // Get file extension from S3 key
              const s3FileName = s3Key.split("/").pop() || "model.step";
              const extension = s3FileName.includes(".") ? s3FileName.substring(s3FileName.lastIndexOf(".")) : ".step";
              // Use part name as filename
              const fileName = `${part.partName}${extension}`;
              const buffer = await response.Body.transformToByteArray();
              filesToZip.push({
                buffer: Buffer.from(buffer),
                path: `${partFolder}${fileName}`,
              });
            }
          } catch (error) {
            console.error(`Error downloading part file ${part.partFileUrl}:`, error);
          }
        })()
      );
    }

    // Note: We don't include part.partMeshUrl (GLB/STL files) - those are only for web preview

    // Download part drawings
    const partDrawingsList = drawingsData.filter(
      (d) => d.quotePartId === part.id
    );

    for (const drawing of partDrawingsList) {
      if (drawing.attachment.s3Key) {
        downloadPromises.push(
          (async () => {
            try {
              const s3Key = extractS3Key(drawing.attachment.s3Key!);
              const command = new GetObjectCommand({
                Bucket: process.env.S3_BUCKET!,
                Key: s3Key,
              });
              const response = await s3Client.send(command);

              if (response.Body) {
                const fileName = drawing.attachment.fileName || s3Key.split("/").pop() || "drawing";
                const buffer = await response.Body.transformToByteArray();
                filesToZip.push({
                  buffer: Buffer.from(buffer),
                  path: `${partFolder}drawings/${fileName}`,
                });
              }
            } catch (error) {
              console.error(`Error downloading drawing ${drawing.attachment.s3Key}:`, error);
            }
          })()
        );
      }
    }
  }

  // Wait for all files to be downloaded
  await Promise.all(downloadPromises);

  // Create archive
  const archive = archiver("zip", {
    zlib: { level: 9 },
  });

  // Collect output - listen directly to archive, not a wrapper stream
  const chunks: Buffer[] = [];

  archive.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });

  archive.on("warning", (err) => {
    console.warn("[downloadQuoteFiles] Archive warning:", err);
  });

  archive.on("error", (err) => {
    console.error("[downloadQuoteFiles] Archive error:", err);
    throw err;
  });

  const archiveFinished = new Promise<void>((resolve, reject) => {
    archive.on("end", () => resolve());
    archive.on("error", reject);
  });

  // Add all files to archive
  for (const file of filesToZip) {
    archive.append(file.buffer, { name: file.path });
  }

  // Finalize the archive
  archive.finalize();

  // Wait for archive to complete
  await archiveFinished;

  // Combine all chunks
  const zipBuffer = Buffer.concat(chunks);

  return {
    buffer: zipBuffer,
    filename: `Quote-${quote.quoteNumber}-Files.zip`,
  };
}
