import { isReceiptKey, receiptKeyForIntakeObject } from "./keys";
import {
  RFQ_PROCESSING_LEASE_MS,
  type ImportLedgerSummary,
  type RfqQueue,
  type RfqStorage,
} from "./types";

export type ScanOutcome = {
  discovered: number;
  enqueued: number;
  skipped: number;
};

export type ReceiptDiscoveryDependencies = {
  enabled: boolean;
  storage: Pick<RfqStorage, "list">;
  queue: Pick<RfqQueue, "enqueue">;
  now(): Date;
  getLedgerSummaries(
    receiptKeys: string[],
  ): Promise<Map<string, ImportLedgerSummary>>;
  getDueLedgerReceiptKeys(now: Date): Promise<string[]>;
};

function shouldEnqueue(
  ledger: ImportLedgerSummary | undefined,
  now: Date,
): boolean {
  if (!ledger) return true;
  if (ledger.status === "pending") return true;
  if (ledger.status === "cleanup_pending") return true;
  if (ledger.status === "completed") return true;
  if (ledger.status === "processing") {
    return (
      ledger.processingStartedAt === null ||
      ledger.processingStartedAt.getTime() <= now.getTime() - RFQ_PROCESSING_LEASE_MS
    );
  }
  if (ledger.status === "retry_scheduled") {
    return ledger.nextAttemptAt !== null && ledger.nextAttemptAt <= now;
  }
  return false;
}

export async function scanForReceipts(
  dependencies: ReceiptDiscoveryDependencies,
): Promise<ScanOutcome> {
  if (!dependencies.enabled) {
    return { discovered: 0, enqueued: 0, skipped: 0 };
  }

  const now = dependencies.now();
  const receiptKeys = new Set<string>(
    await dependencies.getDueLedgerReceiptKeys(now),
  );
  const intakePrefixCandidates = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await dependencies.storage.list("intake/", cursor);
    for (const object of page.objects) {
      if (isReceiptKey(object.key)) {
        receiptKeys.add(object.key);
      } else {
        const candidate = receiptKeyForIntakeObject(object.key);
        if (candidate) intakePrefixCandidates.add(candidate);
      }
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  const summaryKeys = [...new Set([...receiptKeys, ...intakePrefixCandidates])];
  const summaries = await dependencies.getLedgerSummaries(summaryKeys);
  for (const candidate of intakePrefixCandidates) {
    const status = summaries.get(candidate)?.status;
    if (status === "completed" || status === "cleanup_pending") {
      receiptKeys.add(candidate);
    }
  }
  const keys = [...receiptKeys].sort();
  let enqueued = 0;
  let skipped = 0;

  for (const receiptKey of keys) {
    if (shouldEnqueue(summaries.get(receiptKey), now)) {
      await dependencies.queue.enqueue(receiptKey);
      enqueued += 1;
    } else {
      skipped += 1;
    }
  }

  return { discovered: keys.length, enqueued, skipped };
}
