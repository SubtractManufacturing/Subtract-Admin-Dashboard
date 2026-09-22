import type { Job } from "pg-boss";

import { scanForReceipts } from "../../rfq-intake/discovery";
import { createRfqImporter } from "../../rfq-intake/importer";
import {
  getRfqLedgerSummaries,
  postgresRfqPersistence,
} from "../../rfq-intake/postgres.server";
import {
  awsRfqStorage,
  isRfqIntakeEnabled,
} from "../../rfq-intake/storage.server";
import { sendCadConversionJob, sendRfqImportJob } from "../producer.server";
import type { RfqImportPayload, RfqReceiptScanPayload } from "../types";

const queue = {
  async enqueue(receiptKey: string) {
    await sendRfqImportJob({ receiptKey });
  },
  async enqueueDerivedAssets(quotePartIds: string[]) {
    await Promise.all(
      quotePartIds.map((entityId) =>
        sendCadConversionJob({ entityType: "quote_part", entityId }),
      ),
    );
  },
};

const importer = createRfqImporter({
  storage: awsRfqStorage,
  persistence: postgresRfqPersistence,
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
  });
  console.log(
    `[RFQ Intake] scan discovered=${outcome.discovered} enqueued=${outcome.enqueued} skipped=${outcome.skipped}`,
  );
}
