import type { Job } from "pg-boss";
import { and, eq } from "drizzle-orm";
import type { ToolpathReportPollPayload } from "../types";
import { db } from "../../db";
import { quoteParts } from "../../db/schema";
import { createEvent } from "../../events";
import { pollToolpathReportUrl } from "../../toolpath.server";
import { isAllowedToolpathReportUrl } from "../../toolpath";
import {
  TOOLPATH_REPORT_POLL_INTERVAL_MS,
  TOOLPATH_REPORT_POLL_MAX_MS,
  TOOLPATH_UPLOAD_STATUS,
} from "../../toolpath-upload";
import {
  logToolpathUploadAlert,
  TOOLPATH_REPORT_TIMEOUT_ERROR,
} from "../../toolpath-upload.server";

export async function handleToolpathReportPoll(
  jobs: Job<ToolpathReportPollPayload>[],
) {
  for (const job of jobs) {
    const { quotePartId, toolpathPartId, cutConfigId, quoteId } = job.data;
    const start = Date.now();

    console.log(
      `[Worker:ToolpathReportPoll] Processing quote part ${quotePartId} (job ${job.id})`,
    );

    const [part] = await db
      .select({
        id: quoteParts.id,
        partName: quoteParts.partName,
        toolpathUploadStatus: quoteParts.toolpathUploadStatus,
        toolpathReportUrl: quoteParts.toolpathReportUrl,
      })
      .from(quoteParts)
      .where(eq(quoteParts.id, quotePartId))
      .limit(1);

    if (!part) {
      throw new Error(`Quote part ${quotePartId} not found`);
    }

    if (
      part.toolpathReportUrl &&
      isAllowedToolpathReportUrl(part.toolpathReportUrl)
    ) {
      console.log(
        `[Worker:ToolpathReportPoll] ${quotePartId} already has report URL`,
      );
      continue;
    }

    if (part.toolpathUploadStatus !== TOOLPATH_UPLOAD_STATUS.PROCESSING) {
      console.log(
        `[Worker:ToolpathReportPoll] Skipping ${quotePartId} — status is ${part.toolpathUploadStatus}`,
      );
      continue;
    }

    try {
      const reportUrl = await pollToolpathReportUrl({
        partId: toolpathPartId,
        cutConfigId,
        intervalMs: TOOLPATH_REPORT_POLL_INTERVAL_MS,
        maxWaitMs: TOOLPATH_REPORT_POLL_MAX_MS,
      });

      if (!reportUrl) {
        await markReportPollFailed({
          quotePartId,
          quoteId,
          partName: part.partName,
          toolpathPartId,
          error: TOOLPATH_REPORT_TIMEOUT_ERROR,
          jobId: job.id,
        });
        continue;
      }

      await db
        .update(quoteParts)
        .set({
          toolpathReportUrl: reportUrl,
          toolpathUploadedAt: new Date(),
          toolpathUploadStatus: null,
          toolpathUploadError: null,
          updatedAt: new Date(),
        })
        .where(eq(quoteParts.id, quotePartId));

      try {
        await createEvent({
          entityType: "quote",
          entityId: String(quoteId),
          eventType: "toolpath_upload",
          eventCategory: "manufacturing",
          title: "Toolpath upload completed",
          description: `Uploaded ${part.partName} to Toolpath`,
          metadata: {
            quoteId,
            quotePartId,
            partName: part.partName,
            success: true,
            toolpathPartId,
            toolpathReportUrl: reportUrl,
            jobId: job.id,
            durationMs: Date.now() - start,
          },
        });
      } catch (eventError) {
        console.error("Failed to log Toolpath upload success event:", eventError);
      }

      console.log(
        `[Worker:ToolpathReportPoll] ${quotePartId} completed in ${Date.now() - start}ms`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Toolpath report poll failed";

      await markReportPollFailed({
        quotePartId,
        quoteId,
        partName: part.partName,
        toolpathPartId,
        error: message,
        jobId: job.id,
      });

      throw error;
    }
  }
}

async function markReportPollFailed(opts: {
  quotePartId: string;
  quoteId: number;
  partName: string;
  toolpathPartId: string;
  error: string;
  jobId: string;
}): Promise<void> {
  logToolpathUploadAlert("Toolpath report poll failed", {
    quotePartId: opts.quotePartId,
    quoteId: opts.quoteId,
    toolpathPartId: opts.toolpathPartId,
    jobId: opts.jobId,
    error: opts.error,
  });

  await db
    .update(quoteParts)
    .set({
      toolpathUploadStatus: TOOLPATH_UPLOAD_STATUS.FAILED,
      toolpathUploadError: opts.error,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(quoteParts.id, opts.quotePartId),
        eq(quoteParts.toolpathUploadStatus, TOOLPATH_UPLOAD_STATUS.PROCESSING),
      ),
    );

  try {
    await createEvent({
      entityType: "quote",
      entityId: String(opts.quoteId),
      eventType: "toolpath_upload",
      eventCategory: "manufacturing",
      title: "Toolpath upload failed",
      description: `Failed to get Toolpath report for ${opts.partName}: ${opts.error}`,
      metadata: {
        quoteId: opts.quoteId,
        quotePartId: opts.quotePartId,
        partName: opts.partName,
        success: false,
        toolpathPartId: opts.toolpathPartId,
        error: opts.error,
        jobId: opts.jobId,
      },
    });
  } catch (eventError) {
    console.error("Failed to log Toolpath report poll failure event:", eventError);
  }
}
