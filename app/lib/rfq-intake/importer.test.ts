import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { createRfqImporter } from "./importer";
import type {
  PreparedImport,
  RfqPersistence,
  RfqQueue,
  RfqStorage,
  StoredObject,
} from "./types";

const SESSION_ID = "018f0f7d-9f65-7eb4-bf9c-0fca82a87a10";
const PART_ID = "018f0f7d-9f65-7eb4-bf9c-0fca82a87a20";
const UPLOAD_ID = "018f0f7d-9f65-7eb4-bf9c-0fca82a87a30";
const RECEIPT_KEY = `intake/${SESSION_ID}/meta/receipt.json`;
const MANIFEST_KEY = `intake/${SESSION_ID}/meta/manifest.json`;
const CAD_KEY = `intake/${SESSION_ID}/parts/${PART_ID}/${UPLOAD_ID}-widget.step`;
const ORPHAN_KEY = `intake/${SESSION_ID}/uploads/orphan.txt`;

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

  async findImportByReceiptKey(): Promise<
    Awaited<ReturnType<RfqPersistence["findImportByReceiptKey"]>>
  > {
    return null;
  }

  async claimImport() {
    return { kind: "claimed" as const, attemptCount: 1 };
  }

  async commitImport(prepared: PreparedImport) {
    this.committed = prepared;
    return { quoteId: 42, quotePartIds: prepared.parts.map((part) => part.quotePartId) };
  }

  async recordFailure(input: Parameters<RfqPersistence["recordFailure"]>[0]) {
    this.failure = input;
  }

  async markCleanupPending() {}
  async markCompleted() {}
}

function fixture() {
  const storage = new MemoryStorage();
  storage.put(RECEIPT_KEY, {
    receipt_number: "RFQ-2026-0001",
    session_id: SESSION_ID,
    manifest_key: MANIFEST_KEY,
  });
  storage.put(MANIFEST_KEY, {
    session_id: SESSION_ID,
    contact: {
      first_name: "Ada",
      last_name: "Lovelace",
      company: "Analytical Engines",
      email: " ADA@EXAMPLE.COM ",
      phone_number: { country_code: "1", national_number: "415 555 0100" },
    },
    nda_required: true,
    destination_postal_code: "94107",
    requested_delivery_date: "2026-10-15",
    parts: [
      {
        id: PART_ID,
        quantity: 3,
        material: "6061-T6",
        tolerance: { category: "Standard", detail: "+/- 0.005" },
        target_unit_price: "12.34",
        notes: "Deburr edges",
        cad: {
          key: CAD_KEY,
          original_filename: `${UPLOAD_ID}-widget.step`,
          content_type: "application/step",
        },
        drawings: [],
      },
    ],
    compatible_future_field: { retained: true },
  });
  storage.put(CAD_KEY, "step-data", "application/step");
  storage.put(ORPHAN_KEY, "raw audit evidence", "text/plain");
  return storage;
}

describe("importReceipt", () => {
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
    expect(outcome).toEqual({
      status: "completed",
      quoteId: 42,
    });

    const prepared = persistence.committed!;
    expect(prepared.manifest.contact.email).toBe("ada@example.com");
    expect(prepared.manifest.ndaRequired).toBe(true);
    expect(prepared.manifest.raw.compatible_future_field).toEqual({ retained: true });
    expect(prepared.parts[0]).toMatchObject({
      partName: "widget",
      quantity: 3,
      material: "6061-T6",
      tolerance: "Standard",
      canonicalCadKey: expect.stringMatching(
        /^quote-parts\/[0-9a-f-]+\/source\/018f0f7d.*-widget\.step$/,
      ),
    });
    expect(prepared.parts[0].note).toContain("Customer target unit price: 12.34");
    expect(prepared.quoteNote).toContain("Destination postal code: 94107");
    expect(prepared.quoteNote).not.toContain("RFQ-2026-0001");
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

    await expect(importer.importReceipt(RECEIPT_KEY)).resolves.toEqual({
      status: "permanent_failure",
      classification: "security",
    });
    expect(persistence.committed).toBeNull();
    expect(persistence.failure?.nextAttemptAt).toBeNull();
    expect(persistence.failure?.receipt.receiptNumber).toMatch(/^invalid-/);
    expect(storage.objects.has(CAD_KEY)).toBe(true);
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

    await expect(importer.importReceipt(RECEIPT_KEY)).resolves.toEqual({
      status: "retry_scheduled",
      nextAttemptAt: new Date("2026-09-21T00:01:00Z"),
    });
    expect(persistence.failure).toMatchObject({
      classification: "infrastructure",
      attemptCount: 1,
    });
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
            },
            status: "cleanup_pending",
            quoteId: committedQuoteId,
          }
        : null;
    persistence.commitImport = async (prepared) => {
      commitCount += 1;
      persistence.committed = prepared;
      committedQuoteId = 42;
      return { quoteId: 42, quotePartIds: prepared.parts.map((part) => part.quotePartId) };
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
    expect(firstOutcome).toEqual({
      status: "cleanup_pending",
      quoteId: 42,
    });
    await expect(importer.importReceipt(RECEIPT_KEY)).resolves.toEqual({
      status: "already_completed",
      quoteId: 42,
    });
    expect(commitCount).toBe(1);
    expect(deleteAttempts).toBe(2);
  });
});
