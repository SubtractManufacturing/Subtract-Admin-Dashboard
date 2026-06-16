import "dotenv/config";
import type { Job } from "pg-boss";
import { createEvent } from "../app/lib/events";
import {
  QUEUES,
  type CadConversionPayload,
  type MockJobPayload,
  type PurgeArchivedLineItemsPayload,
  type SendEmailPayload,
} from "../app/lib/queue/types";
import { handleCadConversion } from "../app/lib/queue/handlers/cad-conversion";
import { handlePurgeArchivedLineItems } from "../app/lib/queue/handlers/purge-archived-line-items";
import { handleSendEmail } from "../app/lib/queue/handlers/send-email";
import { startWorkerQueue, stopWorkerQueue } from "../app/lib/queue/worker.server";

let isShuttingDown = false;

async function handleMockJob(jobs: Job<MockJobPayload>[]) {
  for (const job of jobs) {
    const start = Date.now();
    console.log(`[Worker] Processing ${job.name} job ${job.id}`, job.data);

    try {
      await createEvent({
        entityType: "system",
        entityId: "worker",
        eventType: "mock_job_completed",
        eventCategory: "system",
        title: "Mock worker job completed",
        description: `Processed: ${job.data.message}`,
        metadata: {
          jobId: job.id,
          queue: job.name,
          triggeredAt: job.data.triggeredAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - start,
        },
      });

      console.log(`[Worker] Job ${job.id} completed in ${Date.now() - start}ms`);
    } catch (error) {
      console.error(`[Worker] Job ${job.id} failed:`, error);
      throw error;
    }
  }
}

async function main() {
  console.log("[Worker] Starting pg-boss worker process...");
  console.log(`[Worker] NODE_ENV=${process.env.NODE_ENV ?? "undefined"}`);

  const boss = await startWorkerQueue();

  await boss.work<MockJobPayload>(QUEUES.MOCK_JOB, { batchSize: 1 }, handleMockJob);
  console.log(`[Worker] Listening on queue: ${QUEUES.MOCK_JOB}`);

  await boss.work<CadConversionPayload>(
    QUEUES.CAD_CONVERSION,
    { batchSize: 1 },
    handleCadConversion,
  );
  console.log(`[Worker] Listening on queue: ${QUEUES.CAD_CONVERSION}`);

  await boss.work<SendEmailPayload>(
    QUEUES.SEND_EMAIL,
    { batchSize: 1 },
    handleSendEmail,
  );
  console.log(`[Worker] Listening on queue: ${QUEUES.SEND_EMAIL}`);

  await boss.work<PurgeArchivedLineItemsPayload>(
    QUEUES.PURGE_ARCHIVED_LINE_ITEMS,
    { batchSize: 1 },
    handlePurgeArchivedLineItems,
  );
  console.log(`[Worker] Listening on queue: ${QUEUES.PURGE_ARCHIVED_LINE_ITEMS}`);

  await boss.schedule(
    QUEUES.PURGE_ARCHIVED_LINE_ITEMS,
    "0 * * * *",
    { triggeredAt: new Date().toISOString() },
  );
  console.log(
    `[Worker] Scheduled hourly purge: ${QUEUES.PURGE_ARCHIVED_LINE_ITEMS}`,
  );

  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log(`[Worker] Received ${signal}, shutting down...`);
    await stopWorkerQueue();
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  console.log("[Worker] Ready and waiting for jobs");
}

main().catch((error) => {
  console.error("[Worker] Fatal startup error:", error);
  process.exit(1);
});
