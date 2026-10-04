import { isReceiptKey, receiptKeyForIntakeObject } from "./keys";
import {
  RFQ_PROCESSING_LEASE_MS,
  type ImportLedgerSummary,
  type RfqQueue,
  type RfqIntakeStorage,
} from "./types";

export type ScanOutcome = {
  discovered: number;
  enqueued: number;
  newImports: number;
  skipped: number;
  skipReasons: Record<string, number>;
};

export type ReceiptDiscoveryDependencies = {
  enabled: boolean;
  storage: Pick<RfqIntakeStorage, "list">;
  queue: Pick<RfqQueue, "enqueue">;
  now(): Date;
  getLedgerSummaries(
    receiptKeys: string[],
  ): Promise<Map<string, ImportLedgerSummary>>;
  getDueLedgerReceiptKeys(now: Date): Promise<string[]>;
};

function discoveryDecision(
  ledger: ImportLedgerSummary | undefined,
  now: Date,
  selectedAsDue: boolean,
): { enqueue: boolean; newImport: boolean; skipReason?: string } {
  if (!ledger || ledger.status === "pending") {
    return { enqueue: true, newImport: true };
  }
  if (ledger.status === "cleanup_pending" || ledger.status === "completed") {
    return { enqueue: true, newImport: false };
  }
  if (ledger.status === "processing") {
    const leaseExpired =
      selectedAsDue ||
      ledger.processingStartedAt === null ||
      ledger.processingStartedAt.getTime() <= now.getTime() - RFQ_PROCESSING_LEASE_MS;
    return leaseExpired
      ? { enqueue: true, newImport: true }
      : {
          enqueue: false,
          newImport: false,
          skipReason: "processing_lease_active",
        };
  }
  if (ledger.status === "retry_scheduled") {
    return selectedAsDue ||
      (ledger.nextAttemptAt !== null && ledger.nextAttemptAt <= now)
      ? { enqueue: true, newImport: true }
      : { enqueue: false, newImport: false, skipReason: "retry_not_due" };
  }
  return { enqueue: false, newImport: false, skipReason: ledger.status };
}

export async function scanForReceipts(
  dependencies: ReceiptDiscoveryDependencies,
): Promise<ScanOutcome> {
  if (!dependencies.enabled) {
    return {
      discovered: 0,
      enqueued: 0,
      newImports: 0,
      skipped: 0,
      skipReasons: {},
    };
  }

  const now = dependencies.now();
  // SQL compares the ledger's timestamp-without-time-zone values without the
  // local-time decoding shift that can occur after they become JavaScript
  // Dates. Treat its due set as authoritative.
  const dueLedgerReceiptKeys = new Set(
    await dependencies.getDueLedgerReceiptKeys(now),
  );
  const receiptKeys = new Set<string>(dueLedgerReceiptKeys);
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
  let newImports = 0;
  let skipped = 0;
  const skipReasons: Record<string, number> = {};

  for (const receiptKey of keys) {
    const selectedAsDue = dueLedgerReceiptKeys.has(receiptKey);
    const ledger = summaries.get(receiptKey);
    const decision = discoveryDecision(ledger, now, selectedAsDue);
    if (decision.enqueue) {
      await dependencies.queue.enqueue(receiptKey);
      enqueued += 1;
      if (decision.newImport) {
        newImports += 1;
      }
    } else {
      skipped += 1;
      const reason = decision.skipReason ?? "unknown";
      skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
    }
  }

  return {
    discovered: keys.length,
    enqueued,
    newImports,
    skipped,
    skipReasons,
  };
}
