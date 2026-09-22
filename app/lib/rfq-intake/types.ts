import type { Readable } from "node:stream";

export type ImportStatus =
  | "pending"
  | "processing"
  | "retry_scheduled"
  | "permanent_failure"
  | "cleanup_pending"
  | "completed";

export type ImportLedgerSummary = {
  status: ImportStatus;
  nextAttemptAt: Date | null;
  processingStartedAt: Date | null;
};

export const RFQ_PROCESSING_LEASE_MS = 30 * 60_000;

export type StoredObject = {
  key: string;
  size: number;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
};

export type StoredObjectPage = {
  objects: StoredObject[];
  nextCursor: string | null;
};

export interface RfqStorage {
  list(prefix: string, cursor?: string): Promise<StoredObjectPage>;
  head(key: string): Promise<StoredObject | null>;
  read(key: string): Promise<Readable>;
  readJson(key: string): Promise<unknown>;
  copy(sourceKey: string, destinationKey: string): Promise<void>;
  uploadStream(
    key: string,
    body: Readable,
    contentType: string,
  ): Promise<StoredObject>;
  deletePrefix(prefix: string): Promise<void>;
}

export interface RfqQueue {
  enqueue(receiptKey: string): Promise<void>;
  enqueueDerivedAssets(
    quotePartIds: string[],
    drawingAttachmentIds: string[],
  ): Promise<void>;
}

export type ReceiptPointer = {
  receiptNumber: string;
  sessionId: string;
  receiptKey: string;
  manifestKey: string;
};

export type IntakeContact = {
  firstName: string;
  lastName: string;
  company: string | null;
  email: string;
  phone: string | null;
};

export type IntakePart = {
  id: string;
  quantity: number;
  cad: { key: string; fileName: string; contentType: string | null };
  drawings: Array<{ key: string; fileName: string; contentType: string | null }>;
  material: string | null;
  tolerance: string | null;
  note: string;
  raw: Record<string, unknown>;
};

export type IntakeManifest = {
  sessionId: string;
  contact: IntakeContact;
  ndaRequired: boolean;
  requestedDeliveryDate: string | null;
  leadTimePreference: string | null;
  destinationPostalCode: string | null;
  poNumber: string | null;
  globalNotes: string | null;
  parts: IntakePart[];
  raw: Record<string, unknown>;
};

export type PreparedPart = IntakePart & {
  quotePartId: string;
  partName: string;
  canonicalCadKey: string;
  canonicalDrawings: Array<{
    key: string;
    fileName: string;
    contentType: string;
    size: number;
  }>;
};

export type PreparedImport = {
  receipt: ReceiptPointer;
  manifest: IntakeManifest;
  parts: PreparedPart[];
  quoteNote: string;
  archive: {
    key: string;
    fileName: string;
    contentType: "application/zip";
    size: number;
  };
  now: Date;
};

export type ImportClaim =
  | { kind: "claimed"; attemptCount: number }
  | { kind: "already_completed"; quoteId: number }
  | { kind: "cleanup_only"; quoteId: number; sessionId: string }
  | { kind: "already_processing" };

export interface RfqPersistence {
  findImportByReceiptKey(receiptKey: string): Promise<{
    receipt: ReceiptPointer;
    status: ImportStatus;
    quoteId: number | null;
  } | null>;
  claimImport(receipt: ReceiptPointer, now: Date): Promise<ImportClaim>;
  commitImport(
    prepared: PreparedImport,
  ): Promise<{
    quoteId: number;
    quotePartIds: string[];
    drawingAttachmentIds: string[];
  }>;
  recordFailure(input: {
    receipt: ReceiptPointer;
    classification: "validation" | "security" | "infrastructure" | "retry_exhausted";
    safeDetail: string;
    attemptCount: number;
    nextAttemptAt: Date | null;
    now: Date;
  }): Promise<void>;
  markCleanupPending(
    receipt: ReceiptPointer,
    quoteId: number,
    safeDetail: string,
    now: Date,
  ): Promise<void>;
  markCompleted(receipt: ReceiptPointer, quoteId: number, now: Date): Promise<void>;
}

export type ImportOutcome =
  | { status: "completed"; quoteId: number }
  | { status: "already_completed"; quoteId: number }
  | { status: "already_processing" }
  | { status: "retry_scheduled"; nextAttemptAt: Date }
  | { status: "permanent_failure"; classification: string }
  | { status: "cleanup_pending"; quoteId: number };
