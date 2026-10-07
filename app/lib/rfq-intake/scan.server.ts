import { sendRfqImportJob } from "../queue/producer.server";
import { scanForReceipts } from "./discovery";
import {
  getDueRfqLedgerReceiptKeys,
  getRfqLedgerSummaries,
} from "./postgres.server";
import {
  awsRfqIntakeStorage,
  isRfqIntakeEnabled,
} from "./storage.server";

export async function scanRfqReceipts() {
  return scanForReceipts({
    enabled: isRfqIntakeEnabled(),
    storage: awsRfqIntakeStorage,
    queue: {
      async enqueue(receiptKey) {
        await sendRfqImportJob({ receiptKey });
      },
    },
    now: () => new Date(),
    getLedgerSummaries: getRfqLedgerSummaries,
    getDueLedgerReceiptKeys: getDueRfqLedgerReceiptKeys,
  });
}
