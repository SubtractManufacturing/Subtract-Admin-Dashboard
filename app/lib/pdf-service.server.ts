import { generatePdf } from "./pdf-generator.server";
import { uploadFile, generateFileKey } from "./s3.server";
import { createAttachment, type AttachmentEventContext } from "./attachments";
import { createEvent } from "./events";
import { db } from "./db";
import {
  quoteAttachments,
  orderAttachments,
  customerAttachments,
  vendorAttachments
} from "./db/schema";

export type EntityType = "quote" | "order" | "customer" | "vendor";

export interface GenerateDocumentPdfOptions {
  entityType: EntityType;
  entityId: number;
  htmlContent: string;
  filename: string;
  userId?: string;
  userEmail?: string;
}

export interface GenerateDocumentPdfResult {
  pdfBuffer: Buffer;
  attachmentId: string;
}

/**
 * Generic PDF generation service that can be used for any entity type
 * Handles PDF generation, S3 upload, attachment creation, and entity linking
 */
export async function generateDocumentPdf(
  options: GenerateDocumentPdfOptions
): Promise<GenerateDocumentPdfResult> {
  const { entityType, entityId, htmlContent, filename, userId, userEmail } = options;

  // Wrap HTML in full document
  const fullHtml = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${filename}</title>
      </head>
      <body>
        ${htmlContent}
      </body>
    </html>
  `;

  // Generate PDF
  const pdfBuffer = await generatePdf({
    html: fullHtml,
    filename,
  });

  // Upload to S3
  const fileKey = generateFileKey(entityId, filename);
  const uploadResult = await uploadFile({
    key: fileKey,
    buffer: pdfBuffer,
    contentType: "application/pdf",
    fileName: filename,
  });

  // Create attachment record (skip event logging since we'll log the PDF generation event instead)
  const eventContext: AttachmentEventContext = {
    userId,
    userEmail,
    skipEventLogging: true,  // Skip attachment event for automated PDF generation
  };

  const attachment = await createAttachment(
    {
      s3Bucket: uploadResult.bucket,
      s3Key: uploadResult.key,
      fileName: uploadResult.fileName,
      contentType: uploadResult.contentType,
      fileSize: uploadResult.size,
    },
    eventContext
  );

  // Link attachment to entity
  await linkAttachmentToEntity(entityType, entityId, attachment.id);

  // Log PDF generation event on the entity
  await createEvent({
    entityType,
    entityId: entityId.toString(),
    eventType: "pdf_generated",
    eventCategory: "document",
    title: "PDF Generated",
    description: `Generated PDF document: ${filename}`,
    metadata: {
      fileName: filename,
      attachmentId: attachment.id,
      fileSize: pdfBuffer.length,
    },
    userId,
    userEmail,
  });

  return {
    pdfBuffer,
    attachmentId: attachment.id,
  };
}

/**
 * Links an attachment to the appropriate entity
 */
async function linkAttachmentToEntity(
  entityType: EntityType,
  entityId: number,
  attachmentId: string
): Promise<void> {
  switch (entityType) {
    case "quote":
      await db.insert(quoteAttachments).values({
        quoteId: entityId,
        attachmentId,
      });
      break;
    case "order":
      await db.insert(orderAttachments).values({
        orderId: entityId,
        attachmentId,
      });
      break;
    case "customer":
      await db.insert(customerAttachments).values({
        customerId: entityId,
        attachmentId,
      });
      break;
    case "vendor":
      await db.insert(vendorAttachments).values({
        vendorId: entityId,
        attachmentId,
      });
      break;
    default:
      throw new Error(`Unsupported entity type: ${entityType}`);
  }
}
