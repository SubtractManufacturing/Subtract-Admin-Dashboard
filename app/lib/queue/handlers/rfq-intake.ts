import type { Job } from "pg-boss";

import { scanForReceipts } from "../../rfq-intake/discovery";
import { createRfqImporter } from "../../rfq-intake/importer";
import {
  createPostgresRfqPersistence,
  getDueRfqLedgerReceiptKeys,
  getRfqLedgerSummaries,
} from "../../rfq-intake/postgres.server";
import {
  awsRfqStorage,
  getRfqStorageBucket,
  isRfqIntakeEnabled,
} from "../../rfq-intake/storage.server";
import {
  sendCadConversionJob,
  sendDrawingThumbnailJob,
  sendRfqImportJob,
} from "../producer.server";
import type { RfqImportPayload, RfqReceiptScanPayload } from "../types";

const queue = {
  async enqueue(receiptKey: string) {
    await sendRfqImportJob({ receiptKey });
  },
  async enqueueDerivedAssets(
    quotePartIds: string[],
    drawingAttachmentIds: string[],
  ) {
    await Promise.all(
      [
        ...quotePartIds.map((entityId) =>
          sendCadConversionJob({ entityType: "quote_part", entityId }),
        ),
        ...drawingAttachmentIds.map((attachmentId) =>
          sendDrawingThumbnailJob({ attachmentId }),
        ),
      ],
    );
  },
};

const importer = createRfqImporter({
  storage: awsRfqStorage,
  persistence: createPostgresRfqPersistence({
    attachmentBucket: getRfqStorageBucket(),
  }),
  queue,
  now: () => new Date(),
});

export async function handleRfqImport(jobs: Job<RfqImportPayload>[]) {
  if (!isRfqIntakeEnabled()) return;
  for (const job of jobs) {
    const receiptKey = job.data.receiptKey;
    console.log(
      `[RFQ Intake] ${JSON.stringify({ event: "import_started", receiptKey })}`,
    );
    try {
      const outcome = await importer.importReceipt(receiptKey);
      console.log(
        `[RFQ Intake] ${JSON.stringify({
          event: "import_finished",
          receiptKey,
          receiptNumber: outcome.receiptNumber,
          outcome: outcome.status,
          ...(outcome.status === "permanent_failure"
            ? { classification: outcome.classification, safeError: outcome.safeDetail }
            : {}),
          ...(outcome.status === "retry_scheduled" ||
          outcome.status === "cleanup_pending"
            ? { safeError: outcome.safeDetail }
            : {}),
        })}`,
      );
    } catch (error) {
      const safeError = (error instanceof Error ? error.message : String(error))
        .replace(/[\r\n\t]+/g, " ")
        .slice(0, 500);
      console.error(
        `[RFQ Intake] ${JSON.stringify({
          event: "import_handler_failed",
          receiptKey,
          safeError,
        })}`,
      );
      throw error;
    }
  }
}

export async function handleRfqReceiptScan(jobs: Job<RfqReceiptScanPayload>[]) {
  void jobs;
  const outcome = await scanForReceipts({
    enabled: isRfqIntakeEnabled(),
    storage: awsRfqStorage,
    queue,
    now: () => new Date(),
    getLedgerSummaries: getRfqLedgerSummaries,
    getDueLedgerReceiptKeys: getDueRfqLedgerReceiptKeys,
  });
  console.log(
    `[RFQ Intake] scan discovered=${outcome.discovered} enqueued=${outcome.enqueued} skipped=${outcome.skipped} skipReasons=${JSON.stringify(outcome.skipReasons)}`,
  );
}
