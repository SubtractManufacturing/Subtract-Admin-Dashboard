import path from "node:path";

import { eq } from "drizzle-orm";

import { getCurrentCadVersion } from "../cadVersions";
import { db } from "../db";
import { attachments, partDrawings } from "../db/schema";
import { getLineItemsByOrderId } from "../lineItems";
import { getOrder } from "../orders";
import { getOrderAttachments } from "../attachments";
import { extractS3Key } from "../s3.server";
import type { JobBoardOrderInput } from "./types";

function thumbnailStorageKey(thumbnailUrl: string | null): string | null {
  if (!thumbnailUrl || thumbnailUrl.startsWith("http")) return null;
  return extractS3Key(thumbnailUrl);
}

function cadFileNameFromKey(s3Key: string, fallback: string): string {
  const base = path.basename(s3Key);
  return base || fallback;
}

export async function loadJobBoardOrderInput(
  orderId: number,
): Promise<JobBoardOrderInput | null> {
  const order = await getOrder(orderId);
  if (!order) return null;

  const [lineItems, orderAttachments] = await Promise.all([
    getLineItemsByOrderId(orderId),
    getOrderAttachments(orderId),
  ]);

  const partInputs = [];
  for (const item of lineItems) {
    if (!item.part) continue;

    const currentCadVersion = await getCurrentCadVersion("part", item.part.id);
    let currentCad: { s3Key: string; fileName: string } | null = null;
    if (currentCadVersion) {
      currentCad = {
        s3Key: currentCadVersion.s3Key,
        fileName: currentCadVersion.fileName,
      };
    } else if (item.part.partFileUrl) {
      const s3Key = extractS3Key(item.part.partFileUrl);
      currentCad = {
        s3Key,
        fileName: cadFileNameFromKey(
          s3Key,
          `${item.part.partName || item.part.id}.cad`,
        ),
      };
    }

    const drawingRecords = await db
      .select({ attachment: attachments })
      .from(partDrawings)
      .innerJoin(attachments, eq(partDrawings.attachmentId, attachments.id))
      .where(eq(partDrawings.partId, item.part.id));

    partInputs.push({
      partId: item.part.id,
      partName: item.part.partName,
      quantity: item.lineItem.quantity ?? 1,
      thumbnailS3Key: thumbnailStorageKey(item.part.thumbnailUrl),
      currentCad,
      drawings: drawingRecords.map((record) => ({
        attachmentId: record.attachment.id,
        s3Key: record.attachment.s3Key,
        fileName: record.attachment.fileName,
      })),
    });
  }

  return {
    orderNumber: order.orderNumber,
    ndaRequired: order.ndaRequired,
    deliveryDate: order.deliveryDate,
    leadTime: order.leadTime,
    parts: partInputs,
    attachments: orderAttachments.map((attachment) => ({
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      s3Key: attachment.s3Key,
    })),
  };
}

export async function assertOrderEligibleForJobBoard(orderId: number) {
  const order = await getOrder(orderId);
  if (!order) {
    return { ok: false as const, error: "Order not found" };
  }
  if (order.status !== "Pending") {
    return { ok: false as const, error: "Order is not Pending" };
  }
  if (order.vendorId) {
    return { ok: false as const, error: "Order already has a vendor assigned" };
  }
  return { ok: true as const, order };
}
