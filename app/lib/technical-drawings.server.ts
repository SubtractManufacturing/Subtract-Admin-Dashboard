/**
 * Shared delete flow for technical drawings on quote parts and order parts.
 */

import { db } from "./db";
import {
  quotePartDrawings,
  partDrawings,
  quoteParts,
  parts,
} from "./db/schema";
import { eq, and } from "drizzle-orm";
import { getAttachment, deleteAttachment, type AttachmentEventContext } from "./attachments";
import { deleteFile } from "./s3.server";
import { createEvent } from "./events";

type DrawingDeleteResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

export async function deleteQuotePartDrawing(
  drawingId: string,
  quotePartId: string,
  expectedQuoteId: number,
  eventContext: AttachmentEventContext,
  audit: { userId?: string; userEmail?: string; quoteId: number }
): Promise<DrawingDeleteResult> {
  const [quotePart] = await db
    .select()
    .from(quoteParts)
    .where(eq(quoteParts.id, quotePartId))
    .limit(1);

  if (!quotePart || quotePart.quoteId !== expectedQuoteId) {
    return { ok: false, error: "Quote part not found on this quote", status: 404 };
  }

  const [link] = await db
    .select()
    .from(quotePartDrawings)
    .where(
      and(
        eq(quotePartDrawings.quotePartId, quotePartId),
        eq(quotePartDrawings.attachmentId, drawingId)
      )
    )
    .limit(1);

  if (!link) {
    return { ok: false, error: "Drawing is not linked to this part", status: 404 };
  }

  const attachment = await getAttachment(drawingId);
  if (!attachment) {
    return { ok: false, error: "Drawing not found", status: 404 };
  }

  await db
    .delete(quotePartDrawings)
    .where(
      and(
        eq(quotePartDrawings.quotePartId, quotePartId),
        eq(quotePartDrawings.attachmentId, drawingId)
      )
    );

  try {
    await deleteFile(attachment.s3Key);
    if (attachment.thumbnailS3Key) {
      await deleteFile(attachment.thumbnailS3Key);
    }
  } catch (e) {
    console.error("deleteQuotePartDrawing: S3 delete error:", e);
  }

  await deleteAttachment(drawingId, eventContext);

  await createEvent({
    entityType: "quote",
    entityId: audit.quoteId.toString(),
    eventType: "part_drawing_deleted",
    eventCategory: "system",
    title: "Technical Drawing Deleted",
    description: "Deleted technical drawing from quote part",
    metadata: {
      quotePartId,
      drawingId,
      fileName: attachment.fileName,
    },
    userId: audit.userId,
    userEmail: audit.userEmail,
  });

  return { ok: true };
}

export async function deleteOrderPartDrawing(
  drawingId: string,
  partId: string,
  expectedCustomerId: number,
  eventContext: AttachmentEventContext,
  audit: { userId?: string; userEmail?: string; orderId: number }
): Promise<DrawingDeleteResult> {
  const [part] = await db
    .select()
    .from(parts)
    .where(eq(parts.id, partId))
    .limit(1);

  if (!part || part.customerId !== expectedCustomerId) {
    return { ok: false, error: "Part not found for this order", status: 404 };
  }

  const [link] = await db
    .select()
    .from(partDrawings)
    .where(
      and(
        eq(partDrawings.partId, partId),
        eq(partDrawings.attachmentId, drawingId)
      )
    )
    .limit(1);

  if (!link) {
    return { ok: false, error: "Drawing is not linked to this part", status: 404 };
  }

  const attachment = await getAttachment(drawingId);
  if (!attachment) {
    return { ok: false, error: "Drawing not found", status: 404 };
  }

  await db
    .delete(partDrawings)
    .where(
      and(
        eq(partDrawings.partId, partId),
        eq(partDrawings.attachmentId, drawingId)
      )
    );

  try {
    await deleteFile(attachment.s3Key);
    if (attachment.thumbnailS3Key) {
      await deleteFile(attachment.thumbnailS3Key);
    }
  } catch (e) {
    console.error("deleteOrderPartDrawing: S3 delete error:", e);
  }

  await deleteAttachment(drawingId, eventContext);

  await createEvent({
    entityType: "order",
    entityId: audit.orderId.toString(),
    eventType: "part_drawing_deleted",
    eventCategory: "system",
    title: "Technical Drawing Deleted",
    description: "Deleted technical drawing from part",
    metadata: {
      partId,
      drawingId,
      fileName: attachment.fileName,
    },
    userId: audit.userId,
    userEmail: audit.userEmail,
  });

  return { ok: true };
}
