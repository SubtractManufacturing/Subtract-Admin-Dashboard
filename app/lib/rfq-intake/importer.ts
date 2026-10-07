import { createHash } from "node:crypto";

import { createRawIntakeArchive } from "./archive";
import { intakePrefix, parseReceiptKey } from "./keys";
import {
  IntakeValidationError,
  parseManifest,
  parseReceipt,
  partDisplayName,
  quoteIntakeNote,
} from "./package";
import type {
  RfqLifecycleWebhookEvent,
  RfqNotifier,
} from "./outbound-webhook";
import type {
  ImportOutcome,
  PreparedImport,
  ReceiptPointer,
  RfqCanonicalStorage,
  RfqIntakeStorage,
  RfqPersistence,
  RfqQueue,
} from "./types";

const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
  72 * 60 * 60_000,
] as const;

export type RfqImporterDependencies = {
  intake: RfqIntakeStorage;
  canonical: RfqCanonicalStorage;
  persistence: RfqPersistence;
  queue: RfqQueue;
  notifier?: RfqNotifier;
  now(): Date;
};

function notify(
  dependencies: RfqImporterDependencies,
  event: RfqLifecycleWebhookEvent,
) {
  try {
    dependencies.notifier?.notify(event);
  } catch (error) {
    console.error("[RFQ Intake] outbound notifier failed", error);
  }
}

function notifyRecordedFailure(
  dependencies: RfqImporterDependencies,
  input: {
    recorded: {
      receivedEventId: string | null;
      failedEventId: string | null;
    };
    receipt: ReceiptPointer;
    classification: string;
    safeDetail: string;
    attemptCount: number;
    occurredAt: Date;
  },
) {
  if (input.recorded.receivedEventId) {
    notify(dependencies, {
      eventId: input.recorded.receivedEventId,
      event: "rfq.received",
      occurredAt: input.occurredAt.toISOString(),
      data: {
        receiptNumber: input.receipt.receiptNumber,
        sessionId: input.receipt.sessionId,
      },
    });
  }
  if (input.recorded.failedEventId) {
    notify(dependencies, {
      eventId: input.recorded.failedEventId,
      event: "rfq.failed",
      occurredAt: input.occurredAt.toISOString(),
      data: {
        receiptNumber: input.receipt.receiptNumber,
        sessionId: input.receipt.sessionId,
        classification: input.classification,
        safeDetail: input.safeDetail,
        attemptCount: input.attemptCount,
      },
    });
  }
}

function deterministicUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function safeErrorDetail(error: unknown): string {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 5; depth += 1) {
    if (
      !current ||
      typeof current !== "object" ||
      seen.has(current) ||
      !("cause" in current) ||
      !current.cause
    ) {
      break;
    }
    seen.add(current);
    current = current.cause;
  }
  const detail = current instanceof Error ? current.message : String(current);
  const code =
    current &&
    typeof current === "object" &&
    "code" in current &&
    typeof current.code === "string" &&
    /^[A-Z0-9]{2,10}$/i.test(current.code)
      ? `[${current.code}] `
      : "";
  return `${code}${detail}`.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function receiptPointerFromKey(receiptKey: string): ReceiptPointer {
  const parsedKey = parseReceiptKey(receiptKey);
  const sessionId = parsedKey?.sessionId ?? "00000000-0000-4000-8000-000000000000";
  return {
    receiptNumber: null,
    sessionId,
    receiptKey,
    manifestKey: `${intakePrefix(sessionId)}meta/manifest.json`,
    submittedAt: "",
  };
}

function outcomeReceiptNumber(receipt: ReceiptPointer): string {
  return receipt.receiptNumber ?? receipt.receiptKey;
}

function nextAttempt(now: Date, attemptCount: number): Date | null {
  const delay = RETRY_DELAYS_MS[attemptCount - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

async function readPackageJson(
  storage: RfqIntakeStorage,
  key: string,
  label: string,
): Promise<unknown> {
  try {
    return await storage.readJson(key);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new IntakeValidationError(`${label} is not valid JSON`);
    }
    throw error;
  }
}

async function handleCleanupOnly(
  dependencies: RfqImporterDependencies,
  receipt: ReceiptPointer,
  quoteId: number,
): Promise<ImportOutcome> {
  try {
    await dependencies.intake.deletePrefix(intakePrefix(receipt.sessionId));
    await dependencies.persistence.markCompleted(receipt, quoteId, dependencies.now());
    return {
      status: "already_completed",
      quoteId,
      receiptNumber: outcomeReceiptNumber(receipt),
    };
  } catch (error) {
    const detail = safeErrorDetail(error);
    await dependencies.persistence.markCleanupPending(
      receipt,
      quoteId,
      detail,
      dependencies.now(),
    );
    return {
      status: "cleanup_pending",
      quoteId,
      receiptNumber: outcomeReceiptNumber(receipt),
      safeDetail: detail,
    };
  }
}

async function prepareFiles(
  dependencies: RfqImporterDependencies,
  receipt: ReceiptPointer,
  manifest: ReturnType<typeof parseManifest>,
): Promise<PreparedImport> {
  const parts = [];
  for (const [index, part] of manifest.parts.entries()) {
    const quotePartId = deterministicUuid(
      `${receipt.receiptNumber}:${part.id}:${index + 1}`,
    );
    const cadSource = await dependencies.intake.head(part.cad.key);
    if (!cadSource) {
      throw new IntakeValidationError(`Referenced CAD object is missing: ${part.cad.key}`);
    }
    const canonicalCadKey = `quote-parts/${quotePartId}/source/${part.cad.fileName}`;
    await dependencies.canonical.copyFromIntake(part.cad.key, canonicalCadKey);
    const copiedCad = await dependencies.canonical.head(canonicalCadKey);
    if (!copiedCad || copiedCad.size !== cadSource.size) {
      throw new Error(`Could not verify canonical CAD object: ${canonicalCadKey}`);
    }

    const canonicalDrawings = [];
    for (const [drawingIndex, drawing] of part.drawings.entries()) {
      const drawingSource = await dependencies.intake.head(drawing.key);
      if (!drawingSource) {
        throw new IntakeValidationError(`Referenced drawing object is missing: ${drawing.key}`);
      }
      const key = `quote-parts/${quotePartId}/drawings/${String(drawingIndex + 1).padStart(2, "0")}-${drawing.fileName}`;
      await dependencies.canonical.copyFromIntake(drawing.key, key);
      const copiedDrawing = await dependencies.canonical.head(key);
      if (!copiedDrawing || copiedDrawing.size !== drawingSource.size) {
        throw new Error(`Could not verify canonical drawing object: ${key}`);
      }
      canonicalDrawings.push({
        key,
        fileName: drawing.fileName,
        contentType: drawing.contentType ?? drawingSource.contentType ?? "application/octet-stream",
        size: drawingSource.size,
      });
    }

    parts.push({
      ...part,
      quotePartId,
      partName: partDisplayName(part.cad.fileName),
      canonicalCadKey,
      canonicalDrawings,
    });
  }

  const archiveKey = `rfq-intake-archives/${receipt.receiptNumber!}.zip`;
  const archive = await createRawIntakeArchive({
    intake: dependencies.intake,
    canonical: dependencies.canonical,
    prefix: intakePrefix(receipt.sessionId),
    destinationKey: archiveKey,
  });

  return {
    receipt,
    manifest,
    parts,
    quoteNote: quoteIntakeNote(manifest, receipt),
    archive: {
      key: archiveKey,
      fileName: `${receipt.receiptNumber!}-raw-intake.zip`,
      contentType: "application/zip",
      size: archive.size,
    },
    now: dependencies.now(),
  };
}

export function createRfqImporter(dependencies: RfqImporterDependencies): {
  importReceipt(receiptKey: string): Promise<ImportOutcome>;
} {
  return {
    async importReceipt(receiptKey) {
      let receipt: ReceiptPointer | undefined;
      let attemptCount = 1;
      let claimed = false;

      try {
        if (!parseReceiptKey(receiptKey)) {
          throw new IntakeValidationError("receipt key is invalid", "security");
        }
        const existing = await dependencies.persistence.findImportByReceiptKey(receiptKey);
        if (existing?.status === "completed" && existing.quoteId) {
          return handleCleanupOnly(
            dependencies,
            existing.receipt,
            existing.quoteId,
          );
        }
        if (existing?.status === "cleanup_pending" && existing.quoteId) {
          return handleCleanupOnly(
            dependencies,
            existing.receipt,
            existing.quoteId,
          );
        }
        if (
          existing?.status === "retry_scheduled" &&
          existing.nextAttemptAt &&
          existing.nextAttemptAt > dependencies.now()
        ) {
          return {
            status: "already_processing",
            receiptNumber: outcomeReceiptNumber(existing.receipt),
          };
        }
        if (existing?.status === "permanent_failure") {
          return {
            status: "already_processing",
            receiptNumber: outcomeReceiptNumber(existing.receipt),
          };
        }
        const rawReceipt = await readPackageJson(
          dependencies.intake,
          receiptKey,
          "receipt",
        );
        receipt = parseReceipt(rawReceipt, receiptKey);

        const claimNow = dependencies.now();
        const claim = await dependencies.persistence.claimImport(receipt, claimNow);
        if (claim.kind === "already_completed") {
          return {
            status: "already_completed",
            quoteId: claim.quoteId,
            receiptNumber: outcomeReceiptNumber(receipt),
          };
        }
        if (claim.kind === "already_processing") {
          return {
            status: "already_processing",
            receiptNumber: outcomeReceiptNumber(receipt),
          };
        }
        if (claim.kind === "cleanup_only") {
          return handleCleanupOnly(dependencies, receipt, claim.quoteId);
        }
        attemptCount = claim.attemptCount;
        claimed = true;
        if (claim.receivedEventId) {
          notify(dependencies, {
            eventId: claim.receivedEventId,
            event: "rfq.received",
            occurredAt: claimNow.toISOString(),
            data: {
              receiptNumber: receipt.receiptNumber,
              sessionId: receipt.sessionId,
            },
          });
        }

        const rawManifest = await readPackageJson(
          dependencies.intake,
          receipt.manifestKey,
          "manifest",
        );
        const manifest = parseManifest(rawManifest, receipt);
        const prepared = await prepareFiles(dependencies, receipt, manifest);
        const committed = await dependencies.persistence.commitImport(prepared);
        notify(dependencies, {
          eventId: committed.importedEventId,
          event: "rfq.imported",
          occurredAt: prepared.now.toISOString(),
          data: {
            quoteId: committed.quoteId,
            quoteNumber: committed.quoteNumber,
            customerId: committed.customerId,
            customerName: committed.customerName,
            partCount: committed.partCount,
            ndaRequired: committed.ndaRequired,
          },
        });

        // Derived assets are best-effort and never make a committed Quote unavailable.
        await dependencies.queue
          .enqueueDerivedAssets(
            committed.quotePartIds,
            committed.drawingAttachmentIds,
          )
          .catch((error) => console.error("[RFQ Intake] Derived asset enqueue failed", error));

        try {
          await dependencies.intake.deletePrefix(intakePrefix(receipt.sessionId));
          await dependencies.persistence.markCompleted(
            receipt,
            committed.quoteId,
            dependencies.now(),
          );
          return {
            status: "completed",
            quoteId: committed.quoteId,
            receiptNumber: outcomeReceiptNumber(receipt),
          };
        } catch (error) {
          const detail = safeErrorDetail(error);
          await dependencies.persistence.markCleanupPending(
            receipt,
            committed.quoteId,
            detail,
            dependencies.now(),
          );
          return {
            status: "cleanup_pending",
            quoteId: committed.quoteId,
            receiptNumber: outcomeReceiptNumber(receipt),
            safeDetail: detail,
          };
        }
      } catch (error) {
        const failureReceipt = receipt ?? receiptPointerFromKey(receiptKey);
        if (!claimed) {
          const ledger = await dependencies.persistence.findImportByReceiptKey(receiptKey);
          attemptCount = (ledger?.attemptCount ?? 0) + 1;
        }
        const detail = safeErrorDetail(error);
        const failureNow = dependencies.now();
        if (error instanceof IntakeValidationError) {
          const recorded = await dependencies.persistence.recordFailure({
            receipt: failureReceipt,
            classification: error.classification,
            safeDetail: detail,
            attemptCount,
            nextAttemptAt: null,
            now: failureNow,
          });
          notifyRecordedFailure(dependencies, {
            recorded,
            receipt: failureReceipt,
            classification: error.classification,
            safeDetail: detail,
            attemptCount,
            occurredAt: failureNow,
          });
          return {
            status: "permanent_failure",
            classification: error.classification,
            receiptNumber: outcomeReceiptNumber(failureReceipt),
            safeDetail: detail,
          };
        }

        const retryAt = nextAttempt(failureNow, attemptCount);
        const classification = retryAt ? "infrastructure" : "retry_exhausted";
        const recorded = await dependencies.persistence.recordFailure({
          receipt: failureReceipt,
          classification,
          safeDetail: detail,
          attemptCount,
          nextAttemptAt: retryAt,
          now: failureNow,
        });
        notifyRecordedFailure(dependencies, {
          recorded,
          receipt: failureReceipt,
          classification,
          safeDetail: detail,
          attemptCount,
          occurredAt: failureNow,
        });
        return retryAt
          ? {
              status: "retry_scheduled",
              nextAttemptAt: retryAt,
              receiptNumber: outcomeReceiptNumber(failureReceipt),
              safeDetail: detail,
            }
          : {
              status: "permanent_failure",
              classification: "retry_exhausted",
              receiptNumber: outcomeReceiptNumber(failureReceipt),
              safeDetail: detail,
            };
      }
    },
  };
}
