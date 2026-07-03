import type { Job } from "pg-boss";
import type { ToolpathStaleCleanupPayload } from "../types";
import {
  failStaleToolpathQueuedParts,
  unblockFailedToolpathUploadJobs,
} from "../../toolpath-upload.server";

export async function handleToolpathStaleCleanup(
  jobs: Job<ToolpathStaleCleanupPayload>[],
) {
  for (const job of jobs) {
    const start = Date.now();
    console.log(
      `[Worker:ToolpathStaleCleanup] Processing job ${job.id}`,
      job.data,
    );

    const failedCount = await failStaleToolpathQueuedParts();
    const unblockedCount = await unblockFailedToolpathUploadJobs();

    console.log(
      `[Worker:ToolpathStaleCleanup] Job ${job.id} completed in ${Date.now() - start}ms; failed ${failedCount} stale part(s); unblocked ${unblockedCount} failed job(s)`,
    );
  }
}
