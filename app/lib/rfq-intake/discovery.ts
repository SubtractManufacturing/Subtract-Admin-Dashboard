import { isReceiptKey } from "./keys";
import type { ImportLedgerSummary, RfqQueue, RfqStorage } from "./types";

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
};

function shouldEnqueue(
  ledger: ImportLedgerSummary | undefined,
  now: Date,
): boolean {
  if (!ledger) return true;
  if (ledger.status === "pending") return true;
  if (ledger.status === "cleanup_pending") return true;
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

  const receiptKeys = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await dependencies.storage.list("intake/", cursor);
    for (const object of page.objects) {
      if (isReceiptKey(object.key)) receiptKeys.add(object.key);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  const keys = [...receiptKeys].sort();
  const summaries = await dependencies.getLedgerSummaries(keys);
  let enqueued = 0;
  let skipped = 0;
  const now = dependencies.now();

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
