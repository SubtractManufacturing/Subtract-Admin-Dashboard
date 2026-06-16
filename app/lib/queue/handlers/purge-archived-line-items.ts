import type { Job } from "pg-boss";
import type { PurgeArchivedLineItemsPayload } from "../types";
import { purgeExpiredArchivedLineItems } from "../../line-item-archive.server";

export async function handlePurgeArchivedLineItems(
  jobs: Job<PurgeArchivedLineItemsPayload>[],
) {
  for (const job of jobs) {
    const start = Date.now();
    console.log(
      `[Worker:PurgeArchivedLineItems] Processing job ${job.id}`,
      job.data,
    );

    const result = await purgeExpiredArchivedLineItems();

    console.log(
      `[Worker:PurgeArchivedLineItems] Job ${job.id} completed in ${Date.now() - start}ms`,
      result,
    );

    if (result.errors.length > 0) {
      console.error(
        `[Worker:PurgeArchivedLineItems] ${result.errors.length} item(s) failed during purge`,
        result.errors,
      );
    }
  }
}
