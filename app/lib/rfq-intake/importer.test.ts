import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import wordpressManifest from "./fixtures/wordpress-manifest.json";
import wordpressReceipt from "./fixtures/wordpress-receipt.json";
import { createRfqImporter, safeErrorDetail } from "./importer";
import type {
  PreparedImport,
  RfqPersistence,
  RfqQueue,
  RfqStorage,
  StoredObject,
} from "./types";

const SESSION_ID = "018f0f7d-9f65-7eb4-bf9c-0fca82a87a10";
const PART_ID = "018f0f7d-9f65-7eb4-bf9c-0fca82a87a20";
const CAD_UPLOAD_ID = "018f0f7d-9f65-7eb4-bf9c-0fca82a87a30";
const DRAWING_UPLOAD_A = "018f0f7d-9f65-7eb4-bf9c-0fca82a87a31";
const DRAWING_UPLOAD_B = "018f0f7d-9f65-7eb4-bf9c-0fca82a87a32";
const SUBMITTED_AT = "2026-09-21T12:00:00+00:00";
const RECEIPT_KEY = `intake/${SESSION_ID}/meta/receipt.json`;
const MANIFEST_KEY = `intake/${SESSION_ID}/meta/manifest.json`;
const CAD_KEY = `intake/${SESSION_ID}/parts/${CAD_UPLOAD_ID}_widget.step`;
const DRAWING_A_KEY = `intake/${SESSION_ID}/drawings/${DRAWING_UPLOAD_A}_spec.pdf`;
const DRAWING_B_KEY = `intake/${SESSION_ID}/drawings/${DRAWING_UPLOAD_B}_spec.pdf`;
const DRAFT_KEY = `intake/${SESSION_ID}/meta/draft.json`;
const ORPHAN_KEY = DRAFT_KEY;

describe("safeErrorDetail", () => {
  it("reports the nested database cause instead of a generated SQL statement", () => {
    const databaseError = Object.assign(
      new Error('insert or update on table "quotes" violates foreign key constraint'),
      { code: "23503" },
    );
    const queryError = new Error("Failed query: insert into quotes ...", {
      cause: databaseError,
    });

    expect(safeErrorDetail(queryError)).toBe(
      '[23503] insert or update on table "quotes" violates foreign key constraint',
    );
  });
});

class MemoryStorage implements RfqStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  put(key: string, value: unknown, contentType = "application/json") {
    const body = Buffer.isBuffer(value)
      ? value
      : Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
    this.objects.set(key, { body, contentType });
  }

  private metadata(key: string): StoredObject | null {
    const object = this.objects.get(key);
    return object
      ? {
          key,
          size: object.body.length,
          contentType: object.contentType,
          etag: `etag-${key}`,
          lastModified: new Date("2026-09-20T12:00:00Z"),
        }
      : null;
  }

  async list(prefix: string) {
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => this.metadata(key)!),
      nextCursor: null,
    };
  }

  async head(key: string) {
    return this.metadata(key);
  }

  async read(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error(`Missing ${key}`);
    return Readable.from(object.body);
  }

  async readJson(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error(`Missing ${key}`);
    return JSON.parse(object.body.toString("utf8"));
  }

  async copy(sourceKey: string, destinationKey: string) {
    const source = this.objects.get(sourceKey);
    if (!source) throw new Error(`Missing ${sourceKey}`);
    this.objects.set(destinationKey, { ...source, body: Buffer.from(source.body) });
  }

  async uploadStream(key: string, body: Readable, contentType: string) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    this.objects.set(key, { body: Buffer.concat(chunks), contentType });
    return this.metadata(key)!;
  }

  async deletePrefix(prefix: string) {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) this.objects.delete(key);
    }
  }
}

class MemoryPersistence implements RfqPersistence {
  committed: PreparedImport | null = null;
  failure: Parameters<RfqPersistence["recordFailure"]>[0] | null = null;
  claimAttemptCount = 1;
  ledgerAttemptCount = 0;
  ledgerNextAttemptAt: Date | null = null;

  async findImportByReceiptKey(): Promise<
    Awaited<ReturnType<RfqPersistence["findImportByReceiptKey"]>>
  > {
    if (this.ledgerAttemptCount === 0 && !this.ledgerNextAttemptAt) return null;
    return {
      receipt: {
        receiptNumber: null,
        sessionId: SESSION_ID,
        receiptKey: RECEIPT_KEY,
        manifestKey: MANIFEST_KEY,
        submittedAt: "",
      },
      status: this.ledgerNextAttemptAt ? "retry_scheduled" : "pending",
      quoteId: null,
      attemptCount: this.ledgerAttemptCount,
      nextAttemptAt: this.ledgerNextAttemptAt,
    };
  }

  async claimImport() {
    return { kind: "claimed" as const, attemptCount: this.claimAttemptCount };
  }

  async commitImport(prepared: PreparedImport) {
    this.committed = prepared;
    return {
      quoteId: 42,
      quotePartIds: prepared.parts.map((part) => part.quotePartId),
      drawingAttachmentIds: [],
    };
  }

  async recordFailure(input: Parameters<RfqPersistence["recordFailure"]>[0]) {
    this.failure = input;
    this.ledgerAttemptCount = input.attemptCount;
    this.ledgerNextAttemptAt = input.nextAttemptAt;
  }

  async markCleanupPending() {}
  async markCompleted() {}
}

function fixture() {
  const storage = new MemoryStorage();
  storage.put(RECEIPT_KEY, {
    receipt_number: "RFQ-2026-0001",
    session_id: SESSION_ID,
    submitted_at: SUBMITTED_AT,
    manifest_key: MANIFEST_KEY,
  });
  storage.put(MANIFEST_KEY, {
    session_id: SESSION_ID,
    contact: {
      first_name: "Ada",
      last_name: "Lovelace",
      company: "Analytical Engines",
      email: " ADA@EXAMPLE.COM ",
      phone: "4155550100",
      phone_country_code: "1",
      job_title: null,
    },
    parts: [
      {
        part_id: PART_ID,
        quantity: 3,
        material: "6061-T6",
        tolerance: "standard",
        tolerance_detail: null,
        threads_features: null,
        target_unit_price: 12.34,
        notes: "Deburr edges",
        future_part_field: { retained: true },
        part_file_key: CAD_KEY,
        drawing_file_keys: [DRAWING_A_KEY, DRAWING_B_KEY],
      },
    ],
    global: {
      required_delivery_date: "2026-10-15",
      lead_time_preference: "target_date",
      shipping_destination: { postal_code: "94107" },
      po_number: null,
      nda_required: true,
      notes: null,
    },
    compatible_future_field: { retained: true },
  });
  storage.put(CAD_KEY, "step-data", "application/step");
  storage.put(DRAWING_A_KEY, "drawing-a", "application/pdf");
  storage.put(DRAWING_B_KEY, "drawing-b", "application/pdf");
  storage.put(DRAFT_KEY, { autosave: true }, "application/json");
  return storage;
}

describe("importReceipt", () => {
  it("imports the WordPress manifest contract and preserves additive part fields", async () => {
    const storage = new MemoryStorage();
    const manifest = structuredClone(wordpressManifest) as typeof wordpressManifest & {
      parts: Array<(typeof wordpressManifest.parts)[number] & {
        future_part_field?: { retained: boolean };
      }>;
    };
    manifest.parts[0].future_part_field = { retained: true };
    const receiptNumber = "RFQ-20260922-000003";
    storage.put(RECEIPT_KEY, {
      receipt_number: receiptNumber,
      session_id: SESSION_ID,
      submitted_at: wordpressReceipt.submitted_at,
      manifest_key: MANIFEST_KEY,
    });
    storage.put(MANIFEST_KEY, {
      ...manifest,
      session_id: SESSION_ID,
      parts: manifest.parts.map((part) => ({
        ...part,
        part_file_key: part.part_file_key.replace(wordpressManifest.session_id, SESSION_ID),
        drawing_file_keys: part.drawing_file_keys.map((key) =>
          key.replace(wordpressManifest.session_id, SESSION_ID),
        ),
      })),
    });
    for (const part of manifest.parts) {
      const cadKey = part.part_file_key.replace(wordpressManifest.session_id, SESSION_ID);
      storage.put(cadKey, "step-data", "application/step");
      for (const drawingKey of part.drawing_file_keys) {
        storage.put(
          drawingKey.replace(wordpressManifest.session_id, SESSION_ID),
          "drawing",
          "application/pdf",
        );
      }
    }
    const persistence = new MemoryPersistence();
    const importer = createRfqImporter({
      storage,
      persistence,
      queue: { async enqueue() {}, async enqueueDerivedAssets() {} },
      now: () => new Date("2026-09-22T19:00:00Z"),
    });

    const outcome = await importer.importReceipt(RECEIPT_KEY);
    expect(outcome).toMatchObject({
      status: "completed",
      quoteId: 42,
      receiptNumber,
    });
    expect(persistence.failure).toBeNull();
    expect(persistence.committed).not.toBeNull();
    expect(persistence.committed!.manifest).toMatchObject({
      ndaRequired: false,
      requestedDeliveryDate: null,
      leadTimePreference: "standard",
      destinationPostalCode: "90210",
    });
    expect(persistence.committed!.manifest.contact.phone).toBe("+15551234567");
    expect(persistence.committed!.parts[0]).toMatchObject({
      id: "550e8400-e29b-41d4-a716-446655440001",
      partName: "bracket",
      quantity: 10,
      raw: { future_part_field: { retained: true } },
    });
    expect(persistence.committed!.parts[0].note).toContain("Target price: 12.5");
    expect(persistence.committed!.parts[0].note).toContain(
      'Additional future_part_field: {"retained":true}',
    );
    expect(persistence.committed!.quoteNote).toContain(
      `Quote requested at: ${wordpressReceipt.submitted_at}`,
    );
    expect(persistence.committed!.quoteNote).toContain("Lead-time preference: standard");
    expect(persistence.committed!.quoteNote).toContain("Destination postal code: 90210");
  });

  it("imports one part, preserves metadata, archives the complete prefix, and cleans up", async () => {
    const storage = fixture();
    const persistence = new MemoryPersistence();
    const derived: string[][] = [];
    const queue: RfqQueue = {
      async enqueue() {},
      async enqueueDerivedAssets(ids) {
        derived.push(ids);
      },
    };
    const importer = createRfqImporter({
      storage,
      persistence,
      queue,
      now: () => new Date("2026-09-21T00:00:00Z"),
    });

    const outcome = await importer.importReceipt(RECEIPT_KEY);
    expect(persistence.failure).toBeNull();
    expect(outcome).toMatchObject({
      status: "completed",
      quoteId: 42,
    });

    const prepared = persistence.committed!;
    expect(prepared.manifest.contact.email).toBe("ada@example.com");
    expect(prepared.manifest.contact.phone).toBe("+14155550100");
    expect(prepared.manifest.ndaRequired).toBe(true);
    expect(prepared.manifest.raw.compatible_future_field).toEqual({ retained: true });
    expect(prepared.parts[0]).toMatchObject({
      partName: "widget",
      quantity: 3,
      material: "6061-T6",
      tolerance: "standard",
      canonicalCadKey: expect.stringMatching(
        /^quote-parts\/[0-9a-f-]+\/source\/widget\.step$/,
      ),
    });
    expect(prepared.parts[0].note).toContain("Target price: 12.34");
    expect(prepared.parts[0].note).toContain(
      'Additional future_part_field: {"retained":true}',
    );
    expect(prepared.parts[0].canonicalDrawings.map((drawing) => drawing.key)).toEqual([
      expect.stringMatching(/\/drawings\/01-spec\.pdf$/),
      expect.stringMatching(/\/drawings\/02-spec\.pdf$/),
    ]);
    expect(prepared.quoteNote).toContain("Destination postal code: 94107");
    expect(prepared.quoteNote).toContain(`Quote requested at: ${SUBMITTED_AT}`);
    expect(prepared.quoteNote).toContain("Lead-time preference: target_date");
    expect(storage.objects.has(prepared.archive.key)).toBe(true);
    const archive = storage.objects.get(prepared.archive.key)!.body.toString("latin1");
    expect(archive).toContain(ORPHAN_KEY);
    expect(archive).toContain("archive-index.json");
    expect([...storage.objects.keys()].some((key) => key.startsWith(`intake/${SESSION_ID}/`))).toBe(false);
    expect(derived).toEqual([[prepared.parts[0].quotePartId]]);
  });

  it("stops permanently on an unsafe package before copying or committing", async () => {
    const storage = fixture();
    const receipt = (await storage.readJson(RECEIPT_KEY)) as Record<string, unknown>;
    storage.put(RECEIPT_KEY, { ...receipt, manifest_key: "intake/another-session/manifest.json" });
    const persistence = new MemoryPersistence();
    const importer = createRfqImporter({
      storage,
      persistence,
      queue: { async enqueue() {}, async enqueueDerivedAssets() {} },
      now: () => new Date("2026-09-21T00:00:00Z"),
    });

    await expect(importer.importReceipt(RECEIPT_KEY)).resolves.toMatchObject({
      status: "permanent_failure",
      classification: "security",
    });
    expect(persistence.committed).toBeNull();
    expect(persistence.failure?.nextAttemptAt).toBeNull();
    expect(persistence.failure?.receipt.receiptNumber).toBeNull();
    expect(storage.objects.has(CAD_KEY)).toBe(true);
  });

  it("increments attempt count for infrastructure failures before claim", async () => {
    const storage = new MemoryStorage();
    const persistence = new MemoryPersistence();
    let now = new Date("2026-09-21T00:00:00Z");
    const importer = createRfqImporter({
      storage,
      persistence,
      queue: { async enqueue() {}, async enqueueDerivedAssets() {} },
      now: () => now,
    });

    await expect(importer.importReceipt(RECEIPT_KEY)).resolves.toMatchObject({
      status: "retry_scheduled",
      nextAttemptAt: new Date("2026-09-21T00:01:00Z"),
    });
    expect(persistence.failure?.attemptCount).toBe(1);

    now = new Date("2026-09-21T00:00:30Z");
    await expect(importer.importReceipt(RECEIPT_KEY)).resolves.toMatchObject({
      status: "already_processing",
    });

    now = new Date("2026-09-21T00:01:00Z");
    await expect(importer.importReceipt(RECEIPT_KEY)).resolves.toMatchObject({
      status: "retry_scheduled",
      nextAttemptAt: new Date("2026-09-21T00:06:00Z"),
    });
    expect(persistence.failure?.attemptCount).toBe(2);
  });

  it("schedules bounded infrastructure retries from the controlled clock", async () => {
    const storage = fixture();
    storage.copy = async () => {
      throw new Error("S3 temporarily unavailable");
    };
    const persistence = new MemoryPersistence();
    const importer = createRfqImporter({
      storage,
      persistence,
      queue: { async enqueue() {}, async enqueueDerivedAssets() {} },
      now: () => new Date("2026-09-21T00:00:00Z"),
    });

    await expect(importer.importReceipt(RECEIPT_KEY)).resolves.toMatchObject({
      status: "retry_scheduled",
      nextAttemptAt: new Date("2026-09-21T00:01:00Z"),
    });
    expect(persistence.failure).toMatchObject({
      classification: "infrastructure",
      attemptCount: 1,
    });
  });

  it("classifies malformed JSON as a permanent validation failure", async () => {
    const storage = fixture();
    storage.put(RECEIPT_KEY, "{not-json");
    const persistence = new MemoryPersistence();
    const importer = createRfqImporter({
      storage,
      persistence,
      queue: { async enqueue() {}, async enqueueDerivedAssets() {} },
      now: () => new Date("2026-09-21T00:00:00Z"),
    });

    await expect(importer.importReceipt(RECEIPT_KEY)).resolves.toMatchObject({
      status: "permanent_failure",
      classification: "validation",
    });
    expect(persistence.failure).toMatchObject({
      classification: "validation",
      nextAttemptAt: null,
    });
  });

  it("stops retrying after the bounded retry schedule is exhausted", async () => {
    const storage = fixture();
    storage.copy = async () => {
      throw new Error("S3 remains unavailable");
    };
    const persistence = new MemoryPersistence();
    persistence.claimAttemptCount = 8;
    const importer = createRfqImporter({
      storage,
      persistence,
      queue: { async enqueue() {}, async enqueueDerivedAssets() {} },
      now: () => new Date("2026-09-21T00:00:00Z"),
    });

    await expect(importer.importReceipt(RECEIPT_KEY)).resolves.toMatchObject({
      status: "permanent_failure",
      classification: "retry_exhausted",
    });
    expect(persistence.failure).toMatchObject({
      classification: "retry_exhausted",
      attemptCount: 8,
      nextAttemptAt: null,
    });
  });

  it("does not fail a committed import when derived work cannot be queued", async () => {
    const storage = fixture();
    const persistence = new MemoryPersistence();
    const importer = createRfqImporter({
      storage,
      persistence,
      queue: {
        async enqueue() {},
        async enqueueDerivedAssets() {
          throw new Error("queue unavailable");
        },
      },
      now: () => new Date("2026-09-21T00:00:00Z"),
    });

    await expect(importer.importReceipt(RECEIPT_KEY)).resolves.toMatchObject({
      status: "completed",
      quoteId: 42,
    });
  });

  it("cleans source remnants for an already-completed ledger row", async () => {
    const storage = fixture();
    const persistence = new MemoryPersistence();
    persistence.findImportByReceiptKey = async () => ({
      receipt: {
        receiptNumber: "RFQ-2026-0001",
        sessionId: SESSION_ID,
        receiptKey: RECEIPT_KEY,
        manifestKey: MANIFEST_KEY,
        submittedAt: SUBMITTED_AT,
      },
      status: "completed",
      quoteId: 42,
      attemptCount: 1,
      nextAttemptAt: null,
    });
    const importer = createRfqImporter({
      storage,
      persistence,
      queue: { async enqueue() {}, async enqueueDerivedAssets() {} },
      now: () => new Date("2026-09-21T00:00:00Z"),
    });

    await expect(importer.importReceipt(RECEIPT_KEY)).resolves.toMatchObject({
      status: "already_completed",
      quoteId: 42,
    });
    expect(
      [...storage.objects.keys()].some((key) => key.startsWith(`intake/${SESSION_ID}/`)),
    ).toBe(false);
  });

  it("retries only cleanup after the Quote commit succeeds", async () => {
    const storage = fixture();
    let deleteAttempts = 0;
    const realDelete = storage.deletePrefix.bind(storage);
    storage.deletePrefix = async (prefix) => {
      deleteAttempts += 1;
      if (deleteAttempts === 1) throw new Error("S3 delete timeout");
      await realDelete(prefix);
    };
    const persistence = new MemoryPersistence();
    let committedQuoteId: number | null = null;
    let cleanupPending = false;
    let commitCount = 0;
    persistence.findImportByReceiptKey = async () =>
      cleanupPending
        ? {
            receipt: {
              receiptNumber: "RFQ-2026-0001",
              sessionId: SESSION_ID,
              receiptKey: RECEIPT_KEY,
              manifestKey: MANIFEST_KEY,
              submittedAt: SUBMITTED_AT,
            },
            status: "cleanup_pending",
            quoteId: committedQuoteId,
            attemptCount: 1,
            nextAttemptAt: null,
          }
        : null;
    persistence.commitImport = async (prepared) => {
      commitCount += 1;
      persistence.committed = prepared;
      committedQuoteId = 42;
      return {
        quoteId: 42,
        quotePartIds: prepared.parts.map((part) => part.quotePartId),
        drawingAttachmentIds: [],
      };
    };
    persistence.markCleanupPending = async () => {
      cleanupPending = true;
    };
    persistence.markCompleted = async () => {
      cleanupPending = false;
    };
    const importer = createRfqImporter({
      storage,
      persistence,
      queue: { async enqueue() {}, async enqueueDerivedAssets() {} },
      now: () => new Date("2026-09-21T00:00:00Z"),
    });

    const firstOutcome = await importer.importReceipt(RECEIPT_KEY);
    expect(persistence.failure).toBeNull();
    expect(firstOutcome).toMatchObject({
      status: "cleanup_pending",
      quoteId: 42,
    });
    await expect(importer.importReceipt(RECEIPT_KEY)).resolves.toMatchObject({
      status: "already_completed",
      quoteId: 42,
    });
    expect(commitCount).toBe(1);
    expect(deleteAttempts).toBe(2);
  });
});
