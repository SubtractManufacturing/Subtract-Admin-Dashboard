import type { JobWithMetadata } from "pg-boss";
import { and, eq, or } from "drizzle-orm";
import type { ToolpathUploadPayload } from "../types";
import { db } from "../../db";
import { quoteParts } from "../../db/schema";
import { createEvent } from "../../events";
import { sendToolpathReportPollJob } from "../producer.server";
import {
  isToolpathEnabled,
  uploadQuotePartToToolpath,
} from "../../toolpath.server";
import {
  TOOLPATH_UPLOAD_STATUS,
} from "../../toolpath-upload";
import { logToolpathUploadAlert } from "../../toolpath-upload.server";

export async function handleToolpathUpload(
  jobs: JobWithMetadata<ToolpathUploadPayload>[],
) {
  for (const job of jobs) {
    const { quotePartId, cutConfigId, quoteId, triggeredByUserId } = job.data;
    const start = Date.now();

    console.log(
      `[Worker:ToolpathUpload] Processing quote part ${quotePartId} (job ${job.id})`,
    );

    if (!isToolpathEnabled()) {
      const [partRow] = await db
        .select({
          partName: quoteParts.partName,
          toolpathUploadStatus: quoteParts.toolpathUploadStatus,
        })
        .from(quoteParts)
        .where(eq(quoteParts.id, quotePartId))
        .limit(1);

      if (
        partRow &&
        (partRow.toolpathUploadStatus === TOOLPATH_UPLOAD_STATUS.QUEUED ||
          partRow.toolpathUploadStatus === TOOLPATH_UPLOAD_STATUS.IN_PROGRESS)
      ) {
        await markToolpathUploadFailed({
          quotePartId,
          quoteId,
          partName: partRow.partName,
          error: "Toolpath API not configured",
          jobId: job.id,
          triggeredByUserId,
        });
      }
      continue;
    }

    const claimed = await db
      .update(quoteParts)
      .set({
        toolpathUploadStatus: TOOLPATH_UPLOAD_STATUS.IN_PROGRESS,
        toolpathUploadJobId: job.id,
        toolpathPartId: null,
        toolpathReportUrl: null,
        toolpathUploadedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(quoteParts.id, quotePartId),
          or(
            eq(quoteParts.toolpathUploadStatus, TOOLPATH_UPLOAD_STATUS.QUEUED),
            and(
              eq(
                quoteParts.toolpathUploadStatus,
                TOOLPATH_UPLOAD_STATUS.IN_PROGRESS,
              ),
              eq(quoteParts.toolpathUploadJobId, job.id),
            ),
          ),
        ),
      )
      .returning({
        id: quoteParts.id,
        partName: quoteParts.partName,
        partFileUrl: quoteParts.partFileUrl,
      });

    if (claimed.length === 0) {
      console.log(
        `[Worker:ToolpathUpload] Skipping ${quotePartId} — not in queued state`,
      );
      continue;
    }

    const part = claimed[0];

    if (!part.partFileUrl) {
      await markToolpathUploadFailed({
        quotePartId,
        quoteId,
        partName: part.partName,
        error: "Part does not have a CAD file",
        jobId: job.id,
        triggeredByUserId,
      });
      continue;
    }

    try {
      const uploadResult = await uploadQuotePartToToolpath({
        quotePartId,
        name: part.partName,
        partFileUrl: part.partFileUrl,
        cutConfigId,
        units: "in",
        resolveReport: false,
      });

      await db
        .update(quoteParts)
        .set({
          toolpathPartId: uploadResult.toolpathPartId,
          toolpathCutConfigId: cutConfigId,
          toolpathUploadStatus: TOOLPATH_UPLOAD_STATUS.PROCESSING,
          toolpathUploadError: null,
          toolpathQueuedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(quoteParts.id, quotePartId));

      const pollJobId = await sendToolpathReportPollJob({
        quotePartId,
        toolpathPartId: uploadResult.toolpathPartId,
        cutConfigId,
        quoteId,
      });

      if (!pollJobId) {
        throw new Error("Failed to enqueue Toolpath report poll job");
      }

      console.log(
        `[Worker:ToolpathUpload] ${quotePartId} uploaded in ${Date.now() - start}ms; poll job ${pollJobId}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Toolpath upload failed";
      const isLastAttempt = job.retryCount >= job.retryLimit;

      if (isLastAttempt) {
        await markToolpathUploadFailed({
          quotePartId,
          quoteId,
          partName: part.partName,
          error: message,
          jobId: job.id,
          triggeredByUserId,
        });
        continue;
      }

      await db
        .update(quoteParts)
        .set({
          toolpathUploadStatus: TOOLPATH_UPLOAD_STATUS.QUEUED,
          toolpathUploadError: message,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(quoteParts.id, quotePartId),
            eq(quoteParts.toolpathUploadJobId, job.id),
          ),
        );

      throw error;
    }
  }
}

async function markToolpathUploadFailed(opts: {
  quotePartId: string;
  quoteId: number;
  partName: string;
  error: string;
  jobId: string;
  triggeredByUserId?: string;
}): Promise<void> {
  logToolpathUploadAlert("Toolpath upload failed", {
    quotePartId: opts.quotePartId,
    quoteId: opts.quoteId,
    jobId: opts.jobId,
    error: opts.error,
  });

  await db
    .update(quoteParts)
    .set({
      toolpathUploadStatus: TOOLPATH_UPLOAD_STATUS.FAILED,
      toolpathUploadError: opts.error,
      toolpathQueuedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(quoteParts.id, opts.quotePartId));

  try {
    await createEvent({
      entityType: "quote",
      entityId: String(opts.quoteId),
      eventType: "toolpath_upload",
      eventCategory: "manufacturing",
      title: "Toolpath upload failed",
      description: `Failed to upload ${opts.partName} to Toolpath: ${opts.error}`,
      metadata: {
        quoteId: opts.quoteId,
        quotePartId: opts.quotePartId,
        partName: opts.partName,
        success: false,
        error: opts.error,
        jobId: opts.jobId,
      },
      userId: opts.triggeredByUserId,
    });
  } catch (eventError) {
    console.error("Failed to log Toolpath upload failure event:", eventError);
  }
}
