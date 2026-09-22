import { createHash } from "node:crypto";

import { createRawIntakeArchive } from "./archive";
import { intakePrefix, parseReceiptKey, provisionalReceiptNumber } from "./keys";
import {
  IntakeValidationError,
  parseManifest,
  parseReceipt,
  partDisplayName,
  quoteIntakeNote,
} from "./package";
import type {
  ImportOutcome,
  PreparedImport,
  ReceiptPointer,
  RfqPersistence,
  RfqQueue,
  RfqStorage,
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
  storage: RfqStorage;
  persistence: RfqPersistence;
  queue: RfqQueue;
  now(): Date;
};

function deterministicUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function fallbackReceipt(receiptKey: string): ReceiptPointer {
  const parsedKey = parseReceiptKey(receiptKey);
  // A receipt that failed validation cannot supply an idempotency key: allowing its
  // untrusted receipt number to collide with a valid import could corrupt that ledger.
  const receiptNumber = provisionalReceiptNumber(receiptKey);
  const sessionId = parsedKey?.sessionId ?? "00000000-0000-4000-8000-000000000000";
  return {
    receiptNumber,
    sessionId,
    receiptKey,
    manifestKey: `${intakePrefix(sessionId)}meta/manifest.json`,
  };
}

function nextAttempt(now: Date, attemptCount: number): Date | null {
  const delay = RETRY_DELAYS_MS[attemptCount - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

async function readPackageJson(
  storage: RfqStorage,
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
    await dependencies.storage.deletePrefix(intakePrefix(receipt.sessionId));
    await dependencies.persistence.markCompleted(receipt, quoteId, dependencies.now());
    return { status: "already_completed", quoteId };
  } catch (error) {
    await dependencies.persistence.markCleanupPending(
      receipt,
      quoteId,
      safeDetail(error),
      dependencies.now(),
    );
    return { status: "cleanup_pending", quoteId };
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
    const cadSource = await dependencies.storage.head(part.cad.key);
    if (!cadSource) {
      throw new IntakeValidationError(`Referenced CAD object is missing: ${part.cad.key}`);
    }
    const canonicalCadKey = `quote-parts/${quotePartId}/source/${part.cad.fileName}`;
    await dependencies.storage.copy(part.cad.key, canonicalCadKey);
    const copiedCad = await dependencies.storage.head(canonicalCadKey);
    if (!copiedCad || copiedCad.size !== cadSource.size) {
      throw new Error(`Could not verify canonical CAD object: ${canonicalCadKey}`);
    }

    const canonicalDrawings = [];
    for (const [drawingIndex, drawing] of part.drawings.entries()) {
      const drawingSource = await dependencies.storage.head(drawing.key);
      if (!drawingSource) {
        throw new IntakeValidationError(`Referenced drawing object is missing: ${drawing.key}`);
      }
      const key = `quote-parts/${quotePartId}/drawings/${String(drawingIndex + 1).padStart(2, "0")}-${drawing.fileName}`;
      await dependencies.storage.copy(drawing.key, key);
      const copiedDrawing = await dependencies.storage.head(key);
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

  const archiveKey = `rfq-intake-archives/${receipt.receiptNumber}.zip`;
  const archive = await createRawIntakeArchive({
    storage: dependencies.storage,
    prefix: intakePrefix(receipt.sessionId),
    destinationKey: archiveKey,
  });

  return {
    receipt,
    manifest,
    parts,
    quoteNote: quoteIntakeNote(manifest),
    archive: {
      key: archiveKey,
      fileName: `${receipt.receiptNumber}-raw-intake.zip`,
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
        const rawReceipt = await readPackageJson(
          dependencies.storage,
          receiptKey,
          "receipt",
        );
        receipt = parseReceipt(rawReceipt, receiptKey);

        const claim = await dependencies.persistence.claimImport(
          receipt,
          dependencies.now(),
        );
        if (claim.kind === "already_completed") {
          return { status: "already_completed", quoteId: claim.quoteId };
        }
        if (claim.kind === "already_processing") {
          return { status: "already_processing" };
        }
        if (claim.kind === "cleanup_only") {
          return handleCleanupOnly(dependencies, receipt, claim.quoteId);
        }
        attemptCount = claim.attemptCount;

        const rawManifest = await readPackageJson(
          dependencies.storage,
          receipt.manifestKey,
          "manifest",
        );
        const manifest = parseManifest(rawManifest, receipt);
        const prepared = await prepareFiles(dependencies, receipt, manifest);
        const committed = await dependencies.persistence.commitImport(prepared);

        // Derived assets are best-effort and never make a committed Quote unavailable.
        await dependencies.queue
          .enqueueDerivedAssets(
            committed.quotePartIds,
            committed.drawingAttachmentIds,
          )
          .catch((error) => console.error("[RFQ Intake] Derived asset enqueue failed", error));

        try {
          await dependencies.storage.deletePrefix(intakePrefix(receipt.sessionId));
          await dependencies.persistence.markCompleted(
            receipt,
            committed.quoteId,
            dependencies.now(),
          );
          return { status: "completed", quoteId: committed.quoteId };
        } catch (error) {
          await dependencies.persistence.markCleanupPending(
            receipt,
            committed.quoteId,
            safeDetail(error),
            dependencies.now(),
          );
          return { status: "cleanup_pending", quoteId: committed.quoteId };
        }
      } catch (error) {
        const failureReceipt = receipt ?? fallbackReceipt(receiptKey);
        if (error instanceof IntakeValidationError) {
          await dependencies.persistence.recordFailure({
            receipt: failureReceipt,
            classification: error.classification,
            safeDetail: safeDetail(error),
            attemptCount,
            nextAttemptAt: null,
            now: dependencies.now(),
          });
          return {
            status: "permanent_failure",
            classification: error.classification,
          };
        }

        const retryAt = nextAttempt(dependencies.now(), attemptCount);
        await dependencies.persistence.recordFailure({
          receipt: failureReceipt,
          classification: retryAt ? "infrastructure" : "retry_exhausted",
          safeDetail: safeDetail(error),
          attemptCount,
          nextAttemptAt: retryAt,
          now: dependencies.now(),
        });
        return retryAt
          ? { status: "retry_scheduled", nextAttemptAt: retryAt }
          : { status: "permanent_failure", classification: "retry_exhausted" };
      }
    },
  };
}
