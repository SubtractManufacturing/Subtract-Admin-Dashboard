import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "./db";
import { quoteParts } from "./db/schema";
import {
  TOOLPATH_REPORT_TIMEOUT_ERROR,
  TOOLPATH_STALE_QUEUED_ERROR,
  TOOLPATH_STALE_QUEUED_MS,
  TOOLPATH_UPLOAD_STATUS,
} from "./toolpath-upload";

export function logToolpathUploadAlert(
  message: string,
  context?: Record<string, unknown>,
): void {
  console.error("[ToolpathUpload:ALERT]", message, context ?? "");
}

export function formatToolpathQueueError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("EMAXCONNSESSION") ||
    message.includes("max clients reached")
  ) {
    return "Database connection limit reached. Wait a moment and try again.";
  }
  return message;
}

export async function failStaleToolpathQueuedParts(
  quotePartIds: string[],
): Promise<void> {
  if (quotePartIds.length === 0) return;

  const staleBefore = new Date(Date.now() - TOOLPATH_STALE_QUEUED_MS);

  const staleParts = await db
    .select({
      id: quoteParts.id,
      partName: quoteParts.partName,
      quoteId: quoteParts.quoteId,
    })
    .from(quoteParts)
    .where(
      and(
        inArray(quoteParts.id, quotePartIds),
        eq(quoteParts.toolpathUploadStatus, TOOLPATH_UPLOAD_STATUS.QUEUED),
        lt(quoteParts.updatedAt, staleBefore),
      ),
    );

  for (const part of staleParts) {
    await db
      .update(quoteParts)
      .set({
        toolpathUploadStatus: TOOLPATH_UPLOAD_STATUS.FAILED,
        toolpathUploadError: TOOLPATH_STALE_QUEUED_ERROR,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(quoteParts.id, part.id),
          eq(quoteParts.toolpathUploadStatus, TOOLPATH_UPLOAD_STATUS.QUEUED),
        ),
      );

    logToolpathUploadAlert("Part stuck in queued status", {
      quotePartId: part.id,
      quoteId: part.quoteId,
      partName: part.partName,
    });
  }
}

export { TOOLPATH_REPORT_TIMEOUT_ERROR };
