import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "./db";
import { quoteParts } from "./db/schema";
import { QUEUES } from "./queue/types";
import {
  TOOLPATH_FAILED_JOB_UNBLOCK_ERROR,
  TOOLPATH_PART_CREATION_SINGLETON_KEY,
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

function staleQueuedBeforeCondition(staleBefore: Date) {
  return lt(
    sql`COALESCE(${quoteParts.toolpathQueuedAt}, ${quoteParts.updatedAt})`,
    staleBefore,
  );
}

export async function failStaleToolpathQueuedParts(
  quotePartIds?: string[],
): Promise<number> {
  const staleBefore = new Date(Date.now() - TOOLPATH_STALE_QUEUED_MS);

  const filters = [
    eq(quoteParts.toolpathUploadStatus, TOOLPATH_UPLOAD_STATUS.QUEUED),
    staleQueuedBeforeCondition(staleBefore),
  ];

  if (quotePartIds && quotePartIds.length > 0) {
    filters.push(inArray(quoteParts.id, quotePartIds));
  }

  const staleParts = await db
    .select({
      id: quoteParts.id,
      partName: quoteParts.partName,
      quoteId: quoteParts.quoteId,
    })
    .from(quoteParts)
    .where(and(...filters));

  for (const part of staleParts) {
    await db
      .update(quoteParts)
      .set({
        toolpathUploadStatus: TOOLPATH_UPLOAD_STATUS.FAILED,
        toolpathUploadError: TOOLPATH_STALE_QUEUED_ERROR,
        toolpathQueuedAt: null,
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

  return staleParts.length;
}

interface FailedToolpathUploadJobRow {
  id: string;
  quotePartId: string | null;
  quoteId: number | null;
  errorMessage: string | null;
}

function parseFailedToolpathUploadJob(row: {
  id: string;
  data: unknown;
  output: unknown;
}): FailedToolpathUploadJobRow {
  const data =
    typeof row.data === "object" && row.data !== null
      ? (row.data as Record<string, unknown>)
      : {};
  const output =
    typeof row.output === "object" && row.output !== null
      ? (row.output as Record<string, unknown>)
      : null;

  const quotePartId =
    typeof data.quotePartId === "string" ? data.quotePartId : null;
  const quoteId = typeof data.quoteId === "number" ? data.quoteId : null;
  const errorMessage =
    typeof output?.message === "string"
      ? output.message
      : TOOLPATH_FAILED_JOB_UNBLOCK_ERROR;

  return {
    id: row.id,
    quotePartId,
    quoteId,
    errorMessage,
  };
}

export async function unblockFailedToolpathUploadJobs(): Promise<number> {
  const result = await db.execute(sql`
    SELECT id, data, output
    FROM pgboss.job
    WHERE name = ${QUEUES.TOOLPATH_UPLOAD}
      AND state = 'failed'
      AND singleton_key = ${TOOLPATH_PART_CREATION_SINGLETON_KEY}
  `);

  const failedJobs = (
    result as unknown as Array<{
      id: string;
      data: unknown;
      output: unknown;
    }>
  ).map((row) =>
    parseFailedToolpathUploadJob({
      id: String(row.id),
      data: row.data,
      output: row.output,
    }),
  );

  for (const failedJob of failedJobs) {
    if (failedJob.quotePartId) {
      await db
        .update(quoteParts)
        .set({
          toolpathUploadStatus: TOOLPATH_UPLOAD_STATUS.FAILED,
          toolpathUploadError: failedJob.errorMessage,
          toolpathQueuedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(quoteParts.id, failedJob.quotePartId),
            or(
              eq(
                quoteParts.toolpathUploadStatus,
                TOOLPATH_UPLOAD_STATUS.QUEUED,
              ),
              eq(
                quoteParts.toolpathUploadStatus,
                TOOLPATH_UPLOAD_STATUS.IN_PROGRESS,
              ),
            ),
          ),
        );
    }

    await db.execute(sql`
      DELETE FROM pgboss.job
      WHERE id = ${failedJob.id}
    `);

    logToolpathUploadAlert("Removed failed Toolpath upload job blocking queue", {
      jobId: failedJob.id,
      quotePartId: failedJob.quotePartId,
      quoteId: failedJob.quoteId,
      error: failedJob.errorMessage,
    });
  }

  return failedJobs.length;
}

export { TOOLPATH_REPORT_TIMEOUT_ERROR };
