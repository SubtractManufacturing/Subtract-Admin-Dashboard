import { and, eq, inArray, lte, or } from "drizzle-orm";
import { db } from "./db/client";
import {
  attachments,
  cadFileVersions,
  orderLineItems,
  partDrawings,
  parts,
  quoteLineItems,
  quotePartDrawings,
  quoteParts,
  quotePriceCalculations,
  type QuotePart,
} from "./db/schema";
import { getLineItemArchiveRetentionDays } from "./developerSettings";
import { createEvent } from "./events";
import { computeHardDeleteAt } from "./line-item-archive";
import { recalculateOrderTotal } from "./lineItems";
import { calculateQuoteTotals } from "./quotes";
import { deleteFile, extractS3Key } from "./s3.server";

export type LineItemArchiveEventContext = {
  userId?: string;
  userEmail?: string;
};

export type ArchivedLineItemSummary = {
  id: number;
  name: string;
  quantity: number;
  archivedAt: Date;
  hardDeleteAt: Date;
  quotePartId?: string | null;
  partId?: string | null;
};

async function buildArchiveTimestamps(): Promise<{
  archivedAt: Date;
  hardDeleteAt: Date;
}> {
  const archivedAt = new Date();
  const retentionDays = await getLineItemArchiveRetentionDays();
  const hardDeleteAt = computeHardDeleteAt(archivedAt, retentionDays);
  return { archivedAt, hardDeleteAt };
}

const CLEAR_ARCHIVE_FIELDS = {
  isArchived: false,
  archivedAt: null,
  hardDeleteAt: null,
} as const;

export async function archiveQuoteLineItem(
  lineItemId: number,
  eventContext?: LineItemArchiveEventContext,
): Promise<{ quoteId: number }> {
  const [lineItemRow] = await db
    .select()
    .from(quoteLineItems)
    .where(eq(quoteLineItems.id, lineItemId))
    .limit(1);

  if (!lineItemRow) {
    throw new Error("Line item not found");
  }
  if (lineItemRow.isArchived) {
    throw new Error("Line item is already archived");
  }

  const { archivedAt, hardDeleteAt } = await buildArchiveTimestamps();

  await db.transaction(async (tx) => {
    await tx
      .update(quoteLineItems)
      .set({
        isArchived: true,
        archivedAt,
        hardDeleteAt,
        updatedAt: new Date(),
      })
      .where(eq(quoteLineItems.id, lineItemId));

    if (lineItemRow.quotePartId) {
      await tx
        .update(quoteParts)
        .set({
          isArchived: true,
          archivedAt,
          hardDeleteAt,
          updatedAt: new Date(),
        })
        .where(eq(quoteParts.id, lineItemRow.quotePartId));
    }
  });

  await calculateQuoteTotals(lineItemRow.quoteId);

  let partName = lineItemRow.name || "Unknown Part";
  if (lineItemRow.quotePartId) {
    const [quotePart] = await db
      .select({ partName: quoteParts.partName })
      .from(quoteParts)
      .where(eq(quoteParts.id, lineItemRow.quotePartId))
      .limit(1);
    if (quotePart?.partName) {
      partName = quotePart.partName;
    }
  }

  await createEvent({
    entityType: "quote",
    entityId: lineItemRow.quoteId.toString(),
    eventType: "line_item_archived",
    eventCategory: "financial",
    title: "Line Item Archived",
    description: `Archived ${partName}`,
    metadata: {
      lineItemId,
      partName,
      quantity: lineItemRow.quantity,
      totalPrice: parseFloat(lineItemRow.totalPrice || "0").toFixed(2),
      hardDeleteAt: hardDeleteAt.toISOString(),
    },
    userId: eventContext?.userId,
    userEmail: eventContext?.userEmail,
  });

  return { quoteId: lineItemRow.quoteId };
}

export async function archiveOrderLineItem(
  lineItemId: number,
  eventContext?: LineItemArchiveEventContext,
): Promise<{ orderId: number }> {
  const [lineItemRow] = await db
    .select()
    .from(orderLineItems)
    .where(eq(orderLineItems.id, lineItemId))
    .limit(1);

  if (!lineItemRow) {
    throw new Error("Line item not found");
  }
  if (lineItemRow.isArchived) {
    throw new Error("Line item is already archived");
  }

  const { archivedAt, hardDeleteAt } = await buildArchiveTimestamps();

  await db
    .update(orderLineItems)
    .set({
      isArchived: true,
      archivedAt,
      hardDeleteAt,
    })
    .where(eq(orderLineItems.id, lineItemId));

  const newTotal = await recalculateOrderTotal(lineItemRow.orderId);

  await createEvent({
    entityType: "order",
    entityId: lineItemRow.orderId.toString(),
    eventType: "line_item_archived",
    eventCategory: "system",
    title: "Line Item Archived",
    description: `Archived line item ${lineItemId}`,
    metadata: {
      lineItemId,
      partId: lineItemRow.partId,
      quantity: lineItemRow.quantity,
      unitPrice: lineItemRow.unitPrice,
      newOrderTotal: newTotal.toFixed(2),
      hardDeleteAt: hardDeleteAt.toISOString(),
    },
    userId: eventContext?.userId,
    userEmail: eventContext?.userEmail,
  });

  return { orderId: lineItemRow.orderId };
}

export async function restoreQuoteLineItem(
  lineItemId: number,
  eventContext?: LineItemArchiveEventContext,
): Promise<{ quoteId: number }> {
  const [lineItemRow] = await db
    .select()
    .from(quoteLineItems)
    .where(eq(quoteLineItems.id, lineItemId))
    .limit(1);

  if (!lineItemRow) {
    throw new Error("Line item not found");
  }
  if (!lineItemRow.isArchived) {
    throw new Error("Line item is not archived");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(quoteLineItems)
      .set({
        ...CLEAR_ARCHIVE_FIELDS,
        updatedAt: new Date(),
      })
      .where(eq(quoteLineItems.id, lineItemId));

    if (lineItemRow.quotePartId) {
      await tx
        .update(quoteParts)
        .set({
          ...CLEAR_ARCHIVE_FIELDS,
          updatedAt: new Date(),
        })
        .where(eq(quoteParts.id, lineItemRow.quotePartId));
    }
  });

  await calculateQuoteTotals(lineItemRow.quoteId);

  await createEvent({
    entityType: "quote",
    entityId: lineItemRow.quoteId.toString(),
    eventType: "line_item_restored",
    eventCategory: "financial",
    title: "Line Item Restored",
    description: `Restored line item ${lineItemId}`,
    metadata: {
      lineItemId,
      quantity: lineItemRow.quantity,
      totalPrice: parseFloat(lineItemRow.totalPrice || "0").toFixed(2),
    },
    userId: eventContext?.userId,
    userEmail: eventContext?.userEmail,
  });

  return { quoteId: lineItemRow.quoteId };
}

export async function restoreOrderLineItem(
  lineItemId: number,
  eventContext?: LineItemArchiveEventContext,
): Promise<{ orderId: number }> {
  const [lineItemRow] = await db
    .select()
    .from(orderLineItems)
    .where(eq(orderLineItems.id, lineItemId))
    .limit(1);

  if (!lineItemRow) {
    throw new Error("Line item not found");
  }
  if (!lineItemRow.isArchived) {
    throw new Error("Line item is not archived");
  }

  await db
    .update(orderLineItems)
    .set(CLEAR_ARCHIVE_FIELDS)
    .where(eq(orderLineItems.id, lineItemId));

  const newTotal = await recalculateOrderTotal(lineItemRow.orderId);

  await createEvent({
    entityType: "order",
    entityId: lineItemRow.orderId.toString(),
    eventType: "line_item_restored",
    eventCategory: "system",
    title: "Line Item Restored",
    description: `Restored line item ${lineItemId}`,
    metadata: {
      lineItemId,
      partId: lineItemRow.partId,
      quantity: lineItemRow.quantity,
      unitPrice: lineItemRow.unitPrice,
      newOrderTotal: newTotal.toFixed(2),
    },
    userId: eventContext?.userId,
    userEmail: eventContext?.userEmail,
  });

  return { orderId: lineItemRow.orderId };
}

function collectQuotePartS3Keys(
  quotePart: QuotePart,
  filesToDelete: string[],
): void {
  const keyFile = extractS3Key(quotePart.partFileUrl ?? "");
  if (keyFile) filesToDelete.push(keyFile);

  const keyMesh = extractS3Key(quotePart.partMeshUrl ?? "");
  if (keyMesh) filesToDelete.push(keyMesh);

  const keyThumb = extractS3Key(quotePart.thumbnailUrl ?? "");
  if (keyThumb) filesToDelete.push(keyThumb);
}

export async function hardDeleteQuoteLineItem(
  lineItemId: number,
  eventContext?: LineItemArchiveEventContext,
): Promise<void> {
  const [lineItemRow] = await db
    .select()
    .from(quoteLineItems)
    .where(eq(quoteLineItems.id, lineItemId))
    .limit(1);

  if (!lineItemRow) {
    return;
  }

  const quotePartId = lineItemRow.quotePartId;
  let quotePart: QuotePart | null = null;
  const filesToDelete: string[] = [];
  const drawingAttachmentIds: string[] = [];

  if (quotePartId) {
    const [part] = await db
      .select()
      .from(quoteParts)
      .where(eq(quoteParts.id, quotePartId))
      .limit(1);

    quotePart = part ?? null;

    if (quotePart) {
      collectQuotePartS3Keys(quotePart, filesToDelete);

      const drawingsData = await db
        .select({
          drawing: quotePartDrawings,
          attachment: attachments,
        })
        .from(quotePartDrawings)
        .innerJoin(
          attachments,
          eq(quotePartDrawings.attachmentId, attachments.id),
        )
        .where(eq(quotePartDrawings.quotePartId, quotePartId));

      for (const { attachment } of drawingsData) {
        if (attachment.s3Key) filesToDelete.push(attachment.s3Key);
        if (attachment.thumbnailS3Key) filesToDelete.push(attachment.thumbnailS3Key);
        drawingAttachmentIds.push(attachment.id);
      }

      const cadVersions = await db
        .select({ s3Key: cadFileVersions.s3Key })
        .from(cadFileVersions)
        .where(
          and(
            eq(cadFileVersions.entityType, "quote_part"),
            eq(cadFileVersions.entityId, quotePartId),
          ),
        );
      for (const v of cadVersions) {
        if (v.s3Key) filesToDelete.push(v.s3Key);
      }
    }
  }

  await db.transaction(async (tx) => {
    if (quotePart && quotePartId) {
      await tx
        .delete(quotePartDrawings)
        .where(eq(quotePartDrawings.quotePartId, quotePartId));

      if (drawingAttachmentIds.length > 0) {
        const referencedByParts = await tx
          .select({ attachmentId: partDrawings.attachmentId })
          .from(partDrawings)
          .where(inArray(partDrawings.attachmentId, drawingAttachmentIds));
        const referencedIds = new Set(
          referencedByParts.map((r) => r.attachmentId),
        );
        const safeToDelete = drawingAttachmentIds.filter(
          (id) => !referencedIds.has(id),
        );
        if (safeToDelete.length > 0) {
          await tx
            .delete(attachments)
            .where(inArray(attachments.id, safeToDelete));
        }
      }

      await tx
        .delete(cadFileVersions)
        .where(
          and(
            eq(cadFileVersions.entityType, "quote_part"),
            eq(cadFileVersions.entityId, quotePartId),
          ),
        );

      await tx
        .delete(quotePriceCalculations)
        .where(
          or(
            eq(quotePriceCalculations.quotePartId, quotePartId),
            eq(quotePriceCalculations.quoteLineItemId, lineItemId),
          ),
        );

      await tx.delete(quoteLineItems).where(eq(quoteLineItems.id, lineItemId));
      await tx.delete(quoteParts).where(eq(quoteParts.id, quotePartId));
    } else {
      await tx
        .delete(quotePriceCalculations)
        .where(eq(quotePriceCalculations.quoteLineItemId, lineItemId));
      await tx.delete(quoteLineItems).where(eq(quoteLineItems.id, lineItemId));
    }
  });

  for (const fileKey of filesToDelete) {
    try {
      await deleteFile(fileKey);
    } catch (error: unknown) {
      const err = error as { Code?: string; name?: string };
      if (err?.Code === "NoSuchKey" || err?.name === "NoSuchKey") {
        // ignore
      } else {
        console.error(`Error deleting S3 file ${fileKey}:`, error);
      }
    }
  }

  await calculateQuoteTotals(lineItemRow.quoteId);

  let partName = "Unknown Part";
  if (quotePart?.partName) partName = quotePart.partName;

  await createEvent({
    entityType: "quote",
    entityId: lineItemRow.quoteId.toString(),
    eventType: "quote_line_item_deleted",
    eventCategory: "financial",
    title: "Line Item Deleted",
    description: `Permanently deleted ${partName}`,
    metadata: {
      lineItemId,
      partName,
      quantity: lineItemRow.quantity,
      totalPrice: parseFloat(lineItemRow.totalPrice || "0").toFixed(2),
    },
    userId: eventContext?.userId,
    userEmail: eventContext?.userEmail,
  });
}

export async function hardDeleteOrderLineItem(
  lineItemId: number,
  eventContext?: LineItemArchiveEventContext,
): Promise<void> {
  const [lineItemRow] = await db
    .select()
    .from(orderLineItems)
    .where(eq(orderLineItems.id, lineItemId))
    .limit(1);

  if (!lineItemRow) {
    return;
  }

  await db.delete(orderLineItems).where(eq(orderLineItems.id, lineItemId));

  const newTotal = await recalculateOrderTotal(lineItemRow.orderId);

  await createEvent({
    entityType: "order",
    entityId: lineItemRow.orderId.toString(),
    eventType: "line_item_deleted",
    eventCategory: "system",
    title: "Line Item Deleted",
    description: `Permanently deleted line item ${lineItemId}`,
    metadata: {
      lineItemId,
      partId: lineItemRow.partId,
      quantity: lineItemRow.quantity,
      unitPrice: lineItemRow.unitPrice,
      newOrderTotal: newTotal.toFixed(2),
    },
    userId: eventContext?.userId,
    userEmail: eventContext?.userEmail,
  });
}

export async function listArchivedQuoteLineItems(
  quoteId: number,
): Promise<ArchivedLineItemSummary[]> {
  const rows = await db
    .select({
      id: quoteLineItems.id,
      name: quoteLineItems.name,
      quantity: quoteLineItems.quantity,
      archivedAt: quoteLineItems.archivedAt,
      hardDeleteAt: quoteLineItems.hardDeleteAt,
      quotePartId: quoteLineItems.quotePartId,
      partName: quoteParts.partName,
    })
    .from(quoteLineItems)
    .leftJoin(quoteParts, eq(quoteLineItems.quotePartId, quoteParts.id))
    .where(
      and(
        eq(quoteLineItems.quoteId, quoteId),
        eq(quoteLineItems.isArchived, true),
      ),
    )
    .orderBy(quoteLineItems.archivedAt);

  return rows
    .filter((row) => row.archivedAt && row.hardDeleteAt)
    .map((row) => ({
      id: row.id,
      name: row.name || row.partName || "Line Item",
      quantity: row.quantity,
      archivedAt: row.archivedAt!,
      hardDeleteAt: row.hardDeleteAt!,
      quotePartId: row.quotePartId,
    }));
}

export async function listArchivedOrderLineItems(
  orderId: number,
): Promise<ArchivedLineItemSummary[]> {
  const rows = await db
    .select({
      id: orderLineItems.id,
      name: orderLineItems.name,
      quantity: orderLineItems.quantity,
      archivedAt: orderLineItems.archivedAt,
      hardDeleteAt: orderLineItems.hardDeleteAt,
      partId: orderLineItems.partId,
      partName: parts.partName,
    })
    .from(orderLineItems)
    .leftJoin(parts, eq(orderLineItems.partId, parts.id))
    .where(
      and(
        eq(orderLineItems.orderId, orderId),
        eq(orderLineItems.isArchived, true),
      ),
    )
    .orderBy(orderLineItems.archivedAt);

  return rows
    .filter((row) => row.archivedAt && row.hardDeleteAt)
    .map((row) => ({
      id: row.id,
      name: row.name || row.partName || "Line Item",
      quantity: row.quantity,
      archivedAt: row.archivedAt!,
      hardDeleteAt: row.hardDeleteAt!,
      partId: row.partId,
    }));
}

export type PurgeArchivedLineItemsResult = {
  purgedQuoteLineItems: number;
  purgedOrderLineItems: number;
  errors: Array<{ entityType: "quote" | "order"; lineItemId: number; error: string }>;
};

export async function purgeExpiredArchivedLineItems(): Promise<PurgeArchivedLineItemsResult> {
  const now = new Date();
  const result: PurgeArchivedLineItemsResult = {
    purgedQuoteLineItems: 0,
    purgedOrderLineItems: 0,
    errors: [],
  };

  const expiredQuoteLineItems = await db
    .select({ id: quoteLineItems.id })
    .from(quoteLineItems)
    .where(
      and(
        eq(quoteLineItems.isArchived, true),
        lte(quoteLineItems.hardDeleteAt, now),
      ),
    );

  for (const row of expiredQuoteLineItems) {
    try {
      await hardDeleteQuoteLineItem(row.id);
      result.purgedQuoteLineItems += 1;
    } catch (error) {
      result.errors.push({
        entityType: "quote",
        lineItemId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const expiredOrderLineItems = await db
    .select({ id: orderLineItems.id })
    .from(orderLineItems)
    .where(
      and(
        eq(orderLineItems.isArchived, true),
        lte(orderLineItems.hardDeleteAt, now),
      ),
    );

  for (const row of expiredOrderLineItems) {
    try {
      await hardDeleteOrderLineItem(row.id);
      result.purgedOrderLineItems += 1;
    } catch (error) {
      result.errors.push({
        entityType: "order",
        lineItemId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
