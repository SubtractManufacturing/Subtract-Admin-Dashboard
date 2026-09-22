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
    const outcome = await importer.importReceipt(job.data.receiptKey);
    console.log(`[RFQ Intake] ${job.data.receiptKey}: ${outcome.status}`);
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
    `[RFQ Intake] scan discovered=${outcome.discovered} enqueued=${outcome.enqueued} skipped=${outcome.skipped}`,
  );
}
