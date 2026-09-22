/** Requires DATABASE_URL with the committed migrations applied. */
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { db } from "../db";
import { quotes, rfqImportLedger } from "../db/schema";
import { createRfqImporter } from "./importer";
import { createPostgresRfqPersistence } from "./postgres.server";
import type { RfqStorage, StoredObject } from "./types";

class IntegrationStorage implements RfqStorage {
  objects = new Map<string, { body: Buffer; contentType: string }>();

  put(key: string, value: unknown, contentType = "application/json") {
    this.objects.set(key, {
      body: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)),
      contentType,
    });
  }
  metadata(key: string): StoredObject | null {
    const value = this.objects.get(key);
    return value
      ? { key, size: value.body.length, contentType: value.contentType, etag: "test", lastModified: new Date() }
      : null;
  }
  async list(prefix: string) {
    return { objects: [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => this.metadata(key)!), nextCursor: null };
  }
  async head(key: string) { return this.metadata(key); }
  async read(key: string) { return Readable.from(this.objects.get(key)!.body); }
  async readJson(key: string) { return JSON.parse(this.objects.get(key)!.body.toString("utf8")); }
  async copy(source: string, destination: string) {
    const value = this.objects.get(source)!;
    this.objects.set(destination, { ...value, body: Buffer.from(value.body) });
  }
  async uploadStream(key: string, body: Readable, contentType: string) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    this.objects.set(key, { body: Buffer.concat(chunks), contentType });
    return this.metadata(key)!;
  }
  async deletePrefix(prefix: string) {
    for (const key of this.objects.keys()) if (key.startsWith(prefix)) this.objects.delete(key);
  }
}

describe("RFQ importer with Postgres persistence", () => {
  const postgresRfqPersistence = createPostgresRfqPersistence({
    attachmentBucket: "integration-test",
  });
  const receiptNumber = `TEST-RFQ-${randomUUID()}`;
  const sessionId = randomUUID();
  const partId = randomUUID();
  const uploadId = randomUUID();
  const receiptKey = `intake/${sessionId}/meta/receipt.json`;
  const manifestKey = `intake/${sessionId}/meta/manifest.json`;
  const cadKey = `intake/${sessionId}/parts/${partId}/${uploadId}-bracket.step`;
  const email = `${receiptNumber}@example.invalid`.toLowerCase();
  let quoteId: number | undefined;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  });

  afterAll(async () => {
    if (quoteId) {
      await db.execute(sql`delete from action_items where entity_type = 'quote' and entity_id = ${String(quoteId)}`);
      await db.execute(sql`delete from event_logs where entity_type = 'quote' and entity_id = ${String(quoteId)}`);
      await db.execute(sql`delete from notes where entity_type = 'quote' and entity_id = ${String(quoteId)}`);
      await db.execute(sql`delete from quote_part_drawings where quote_part_id in (select id from quote_parts where quote_id = ${quoteId})`);
      await db.execute(sql`delete from quote_attachments where quote_id = ${quoteId}`);
      await db.execute(sql`delete from quote_line_items where quote_id = ${quoteId}`);
      await db.execute(sql`delete from quote_parts where quote_id = ${quoteId}`);
      await db.execute(sql`delete from attachments where s3_key like ${`rfq-intake-archives/${receiptNumber}%`}`);
      await db.execute(sql`delete from rfq_import_ledger where receipt_number = ${receiptNumber}`);
      await db.delete(quotes).where(eq(quotes.id, quoteId));
      await db.execute(sql`delete from customers where lower(email) = ${email}`);
    }
    await db.execute(sql`delete from action_items where entity_type = 'rfq_import' and entity_id = ${receiptNumber}`);
    await db.execute(sql`delete from event_logs where entity_type = 'rfq_import' and entity_id = ${receiptNumber}`);
    await db.execute(sql`delete from rfq_import_ledger where receipt_key = ${receiptKey}`);
  });

  it("atomically creates the normal Quote graph and remains idempotent", async () => {
    const storage = new IntegrationStorage();
    storage.put(receiptKey, { receipt_number: receiptNumber, session_id: sessionId, manifest_key: manifestKey });
    storage.put(manifestKey, {
      session_id: sessionId,
      contact: { first_name: "Grace", last_name: "Hopper", company: receiptNumber, email },
      nda_required: true,
      destination_postal_code: "10001",
      parts: [{
        id: partId,
        quantity: 4,
        material: "7075",
        tolerance: "Precision",
        target_unit_price: "99.50",
        cad: { key: cadKey, original_filename: `${uploadId}-bracket.step` },
        drawings: [],
      }],
    });
    storage.put(cadKey, "STEP", "application/step");
    storage.put(`intake/${sessionId}/drafts/autosave.json`, { draft: true });
    const provisionalReceiptNumber = `invalid-${createHash("sha256").update(receiptKey).digest("hex").slice(0, 24)}`;
    await postgresRfqPersistence.recordFailure({
      receipt: {
        receiptNumber: provisionalReceiptNumber,
        sessionId,
        receiptKey,
        manifestKey,
      },
      classification: "infrastructure",
      safeDetail: "Receipt temporarily unavailable",
      attemptCount: 1,
      nextAttemptAt: new Date("2026-09-20T00:00:00Z"),
      now: new Date("2026-09-20T00:00:00Z"),
    });
    const importer = createRfqImporter({
      storage,
      persistence: postgresRfqPersistence,
      queue: { async enqueue() {}, async enqueueDerivedAssets() {} },
      now: () => new Date("2026-09-21T00:00:00Z"),
    });

    const outcome = await importer.importReceipt(receiptKey);
    expect(outcome.status).toBe("completed");
    quoteId = outcome.status === "completed" ? outcome.quoteId : undefined;

    const [graph] = await db.execute<{
      source_receipt_number: string;
      created_by_id: string;
      nda_required: boolean;
      part_count: number;
      quantity: number;
      unit_price: string;
      archive_count: number;
      note_content: string;
    }>(sql`
      select q.source_receipt_number, q.created_by_id, q.nda_required,
        (select count(*)::int from quote_parts where quote_id = q.id) part_count,
        (select quantity from quote_line_items where quote_id = q.id limit 1) quantity,
        (select unit_price from quote_line_items where quote_id = q.id limit 1) unit_price,
        (select count(*)::int from quote_attachments qa join attachments a on a.id = qa.attachment_id where qa.quote_id = q.id and a.is_protected) archive_count,
        (select content from notes where entity_type = 'quote' and entity_id = q.id::text limit 1) note_content
      from quotes q where q.id = ${quoteId!}
    `);
    expect(graph).toMatchObject({
      source_receipt_number: receiptNumber,
      created_by_id: "system",
      nda_required: true,
      part_count: 1,
      quantity: 4,
      unit_price: "0.00",
      archive_count: 1,
    });
    expect(graph.note_content).toContain("Destination postal code: 10001");

    const [promoted] = await db.execute<{
      receipt_number: string;
      failure_entity_id: string;
      failure_status: string;
    }>(sql`
      select ledger.receipt_number,
        failure.entity_id failure_entity_id,
        failure.status failure_status
      from rfq_import_ledger ledger
      join action_items failure
        on failure.type = 'rfq_import_failure'
        and failure.entity_type = 'rfq_import'
        and failure.entity_id = ledger.receipt_number
      where ledger.receipt_key = ${receiptKey}
    `);
    expect(promoted).toMatchObject({
      receipt_number: receiptNumber,
      failure_entity_id: receiptNumber,
      failure_status: "resolved",
    });

    await expect(importer.importReceipt(receiptKey)).resolves.toEqual({
      status: "already_completed",
      quoteId,
    });
  });

  it("reclaims an abandoned processing lease", async () => {
    const staleReceiptNumber = `TEST-STALE-${randomUUID()}`;
    const staleSessionId = randomUUID();
    const staleReceiptKey = `intake/${staleSessionId}/meta/receipt.json`;
    const now = new Date("2026-09-21T12:00:00Z");
    await db.insert(rfqImportLedger).values({
      receiptNumber: staleReceiptNumber,
      sessionId: staleSessionId,
      receiptKey: staleReceiptKey,
      status: "processing",
      attemptCount: 1,
      processingStartedAt: new Date("2026-09-21T00:00:00Z"),
    });

    try {
      await expect(
        postgresRfqPersistence.claimImport(
          {
            receiptNumber: staleReceiptNumber,
            sessionId: staleSessionId,
            receiptKey: staleReceiptKey,
            manifestKey: `intake/${staleSessionId}/meta/manifest.json`,
          },
          now,
        ),
      ).resolves.toEqual({ kind: "claimed", attemptCount: 2 });
    } finally {
      await db
        .delete(rfqImportLedger)
        .where(eq(rfqImportLedger.receiptNumber, staleReceiptNumber));
    }
  });
});
