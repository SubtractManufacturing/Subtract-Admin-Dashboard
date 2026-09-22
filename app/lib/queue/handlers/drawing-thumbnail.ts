import type { Job } from "pg-boss";
import { eq } from "drizzle-orm";

import { db } from "../../db";
import { attachments } from "../../db/schema";
import { contentTypeForDrawingFileName } from "../../part-source-files";
import { generatePdfThumbnail, isPdfFile } from "../../pdf-thumbnail.server";
import { downloadFile, uploadFile } from "../../s3.server";
import type { DrawingThumbnailPayload } from "../types";

export async function handleDrawingThumbnail(
  jobs: Job<DrawingThumbnailPayload>[],
) {
  for (const job of jobs) {
    const [attachment] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, job.data.attachmentId))
      .limit(1);
    if (!attachment || attachment.thumbnailS3Key) continue;

    const contentType =
      attachment.contentType || contentTypeForDrawingFileName(attachment.fileName);
    const source = await downloadFile(attachment.s3Key);
    let body: Buffer;
    let extension: string;
    let thumbnailContentType: string;
    if (isPdfFile(contentType, attachment.fileName)) {
      body = (await generatePdfThumbnail(source, 200, 200)).buffer;
      extension = "png";
      thumbnailContentType = "image/png";
    } else if (contentType.startsWith("image/")) {
      body = source;
      extension = attachment.fileName.split(".").pop()?.toLowerCase() || "image";
      thumbnailContentType = contentType;
    } else {
      continue;
    }

    const thumbnailKey = `attachment-thumbnails/${attachment.id}.${extension}`;
    await uploadFile({
      key: thumbnailKey,
      buffer: body,
      contentType: thumbnailContentType,
      fileName: `${attachment.id}.${extension}`,
    });
    await db
      .update(attachments)
      .set({ thumbnailS3Key: thumbnailKey })
      .where(eq(attachments.id, attachment.id));
  }
}
