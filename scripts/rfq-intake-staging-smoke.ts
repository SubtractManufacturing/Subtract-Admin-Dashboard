import "dotenv/config";
import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import postgres from "postgres";

import { getEnv, requireEnv } from "../app/lib/env.server";
import { getS3Client } from "../app/lib/s3.server";

if (getEnv("STAGING") !== "true") {
  throw new Error("RFQ staging smoke refused: STAGING must be exactly true");
}

const appUrl = requireEnv("STAGING_APP_URL").replace(/\/$/, "");
const databaseUrl = requireEnv("DATABASE_URL");
const bucket = requireEnv("S3_BUCKET");
const secret = requireEnv("RFQ_WEBHOOK_SECRET");
const expectedRelease = getEnv("EXPECTED_RELEASE");
const runMarker = `rfq-smoke-${Date.now()}-${randomUUID().slice(0, 8)}`;
const sessionId = randomUUID();
const partId = randomUUID();
const uploadId = randomUUID();
const prefix = `intake/${sessionId}/`;
const receiptKey = `${prefix}meta/receipt.json`;
const manifestKey = `${prefix}meta/manifest.json`;
const cadKey = `${prefix}parts/${partId}/${uploadId}-${runMarker}.step`;
const drawingKey = `${prefix}parts/${partId}/${uploadId}-${runMarker}.pdf`;
const orphanKey = `${prefix}drafts/${runMarker}.json`;
const cadBody = "ISO-10303-21;END-ISO-10303-21;";
const sql = postgres(databaseUrl, { ssl: "require", max: 1, prepare: false });
const s3 = getS3Client();
const uploadedKeys = new Set<string>([receiptKey, manifestKey, cadKey, drawingKey, orphanKey]);

async function waitForRelease() {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${appUrl}/health`);
      const health = (await response.json()) as { status?: string; version?: string };
      if (
        response.ok &&
        health.status === "healthy" &&
        (!expectedRelease || health.version === expectedRelease)
      ) {
        return;
      }
    } catch {
      // Deployment may still be converging.
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error("Staging did not become ready for the expected release");
}

async function putJson(key: string, value: unknown) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json",
    }),
  );
}

async function waitForQuote() {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ id: number }[]>`
      select q.id from quotes q
      join rfq_import_ledger ril on ril.quote_id = q.id
      where q.source_receipt_number = ${runMarker} and ril.status = 'completed'
      limit 1
    `;
    if (rows[0]) return rows[0].id;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("RFQ staging smoke timed out waiting for Quote creation");
}

async function cleanup(quoteId?: number) {
  if (quoteId) {
    const targetQuoteId = quoteId;
    const attachmentRows = await sql<{ id: string; s3_key: string }[]>`
      select a.id, a.s3_key from attachments a
      join quote_attachments qa on qa.attachment_id = a.id
      where qa.quote_id = ${quoteId}
      union
      select a.id, a.s3_key from attachments a
      join quote_part_drawings qpd on qpd.attachment_id = a.id
      join quote_parts qp on qp.id = qpd.quote_part_id
      where qp.quote_id = ${quoteId}
    `;
    for (const row of attachmentRows) uploadedKeys.add(row.s3_key);
    const partRows = await sql<{ part_file_url: string | null }[]>`
      select part_file_url from quote_parts where quote_id = ${quoteId}
    `;
    for (const row of partRows) if (row.part_file_url) uploadedKeys.add(row.part_file_url);

    await sql.begin(async (tx) => {
      await tx.unsafe("delete from action_items where entity_type = 'quote' and entity_id = $1", [String(quoteId)]);
      await tx.unsafe("delete from event_logs where entity_type = 'quote' and entity_id = $1", [String(quoteId)]);
      await tx.unsafe("delete from notes where entity_type = 'quote' and entity_id = $1", [String(quoteId)]);
      await tx.unsafe("delete from quote_part_drawings where quote_part_id in (select id from quote_parts where quote_id = $1)", [targetQuoteId]);
      await tx.unsafe("delete from quote_attachments where quote_id = $1", [targetQuoteId]);
      await tx.unsafe("delete from quote_line_items where quote_id = $1", [targetQuoteId]);
      await tx.unsafe("delete from quote_parts where quote_id = $1", [targetQuoteId]);
      await tx.unsafe("delete from rfq_import_ledger where receipt_number = $1", [runMarker]);
      const customerRows = await tx.unsafe<{ customer_id: number }[]>("select customer_id from quotes where id = $1", [targetQuoteId]);
      await tx.unsafe("delete from quotes where id = $1", [targetQuoteId]);
      if (customerRows[0]) await tx.unsafe("delete from customers where id = $1 and display_name like $2", [customerRows[0].customer_id, `%${runMarker}%`]);
      for (const row of attachmentRows) await tx.unsafe("delete from attachments where id = $1", [row.id]);
    });
  }
  await sql`delete from action_items where entity_type = 'rfq_import' and entity_id = ${runMarker}`;
  await sql`delete from event_logs where entity_type = 'rfq_import' and entity_id = ${runMarker}`;
  await sql`delete from rfq_import_ledger where receipt_number = ${runMarker}`;
  if (uploadedKeys.size) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: [...uploadedKeys].map((Key) => ({ Key })) },
      }),
    );
  }
}

let quoteId: number | undefined;
try {
  await waitForRelease();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: cadKey,
      Body: cadBody,
      ContentType: "application/step",
    }),
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: drawingKey,
      Body: "%PDF-1.4 smoke",
      ContentType: "application/pdf",
    }),
  );
  await putJson(orphanKey, { draft: true, marker: runMarker });
  await putJson(manifestKey, {
    session_id: sessionId,
    contact: {
      first_name: "RFQ",
      last_name: "Smoke",
      company: runMarker,
      email: `${runMarker}@example.invalid`,
    },
    nda_required: true,
    destination_postal_code: "94107",
    global_notes: runMarker,
    parts: [
      {
        id: partId,
        quantity: 2,
        material: "6061-T6",
        tolerance: "Standard",
        cad: { key: cadKey, original_filename: `${uploadId}-${runMarker}.step` },
        drawings: [{ key: drawingKey, original_filename: `${runMarker}.pdf` }],
      },
    ],
  });
  await putJson(receiptKey, {
    receipt_number: runMarker,
    session_id: sessionId,
    manifest_key: manifestKey,
  });

  const rawBody = JSON.stringify({ receipt_key: receiptKey });
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  const response = await fetch(`${appUrl}/api/rfq-intake/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-rfq-signature": `sha256=${signature}`,
    },
    body: rawBody,
  });
  if (response.status !== 202) throw new Error(`Webhook returned ${response.status}`);

  const importedQuoteId = await waitForQuote();
  quoteId = importedQuoteId;
  const [verified] = await sql<{
    part_count: number;
    line_count: number;
    drawing_count: number;
    note_count: number;
    nda_required: boolean;
    customer_email: string;
    customer_display_name: string;
    archive_count: number;
    archive_key: string;
    cad_key: string;
    drawing_key: string;
    failure_count: number;
  }[]>`
    select
      (select count(*)::int from quote_parts where quote_id = ${importedQuoteId}) as part_count,
      (select count(*)::int from quote_line_items where quote_id = ${importedQuoteId}) as line_count,
      (select count(*)::int from quote_part_drawings qpd join quote_parts qp on qp.id = qpd.quote_part_id where qp.quote_id = ${importedQuoteId}) as drawing_count,
      (select count(*)::int from notes where entity_type = 'quote' and entity_id = ${String(importedQuoteId)} and content like ${`%${runMarker}%`}) as note_count,
      q.nda_required,
      c.email as customer_email,
      c.display_name as customer_display_name,
      (select count(*)::int from quote_attachments qa join attachments a on a.id = qa.attachment_id where qa.quote_id = q.id and a.document_kind = 'rfq_intake_archive' and a.is_protected) as archive_count,
      (select a.s3_key from quote_attachments qa join attachments a on a.id = qa.attachment_id where qa.quote_id = q.id and a.document_kind = 'rfq_intake_archive' limit 1) as archive_key,
      (select part_file_url from quote_parts where quote_id = q.id limit 1) as cad_key,
      (select a.s3_key from quote_part_drawings qpd join quote_parts qp on qp.id = qpd.quote_part_id join attachments a on a.id = qpd.attachment_id where qp.quote_id = q.id limit 1) as drawing_key,
      (select count(*)::int from action_items where entity_type = 'rfq_import' and entity_id = ${runMarker} and status = 'active' and deleted_at is null) as failure_count
    from quotes q join customers c on c.id = q.customer_id where q.id = ${importedQuoteId}
  `;
  if (
    !verified ||
    verified.part_count !== 1 ||
    verified.line_count !== 1 ||
    verified.drawing_count !== 1 ||
    verified.note_count !== 1 ||
    !verified.nda_required ||
    verified.customer_email !== `${runMarker}@example.invalid` ||
    !verified.customer_display_name.includes(runMarker) ||
    verified.archive_count !== 1 ||
    verified.failure_count !== 0
  ) {
    throw new Error(`Unexpected staging RFQ state: ${JSON.stringify(verified)}`);
  }
  uploadedKeys.add(verified.archive_key);
  uploadedKeys.add(verified.cad_key);
  uploadedKeys.add(verified.drawing_key);
  for (const key of [verified.archive_key, verified.cad_key, verified.drawing_key]) {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  }
  const archiveResponse = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: verified.archive_key }),
  );
  if (!archiveResponse.Body) throw new Error("RFQ archive returned no body");
  const archiveBytes = Buffer.from(await archiveResponse.Body.transformToByteArray());
  const cadSha256 = createHash("sha256").update(cadBody).digest("hex");
  for (const expectedIndexValue of [
    "archive-index.json",
    cadKey,
    drawingKey,
    orphanKey,
    cadSha256,
  ]) {
    if (!archiveBytes.includes(Buffer.from(expectedIndexValue))) {
      throw new Error(`RFQ archive is missing index evidence: ${expectedIndexValue}`);
    }
  }
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: receiptKey }));
    throw new Error("Source intake prefix was not deleted");
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
  }
  console.log(`RFQ staging smoke passed: ${runMarker}`);
} finally {
  await cleanup(quoteId);
  await sql.end();
}
