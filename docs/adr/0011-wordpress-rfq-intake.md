# ADR-0011: WordPress RFQ intake module

## Status

Accepted

## Context

WordPress RFQ submissions can be discovered by a webhook or an S3 scanner and retried manually. The importer must remain idempotent under concurrent discovery, prepare multi-gigabyte files without buffering them, expose no partial Quote, and distinguish package failures from infrastructure failures and post-commit cleanup failures.

## Decision

RFQ intake is a deep module whose external behavioral interface is `importReceipt(receiptKey) -> ImportOutcome`. Webhook, scanner, Worker, manual retry, and tests use that interface or enqueue the same receipt pointer.

The module owns package validation, deterministic canonical keys, streamed ZIP64 audit archives, retry classification, and cleanup-only recovery. Storage, queue, clock, and persistence are adapters at internal seams. Production uses AWS SDK, pg-boss, and Postgres adapters; tests use controlled in-memory adapters, and the storage contract also runs against MinIO.

S3 preparation happens before the short Postgres transaction. The transaction matches or creates the Customer and atomically inserts the Quote, QuoteParts, line items, Attachments, Notes, audit events, Action Items, and a `cleanup_pending` ledger state. Database uniqueness on receipt number and Quote source receipt number is the final idempotency guard. The Worker processes one RFQ import at a time per receipt; the ledger owns bounded retry timing and a recoverable processing lease rather than pg-boss.

If the database commit succeeds but intake-prefix deletion fails, the ledger remains `cleanup_pending`. The scanner discovers due ledger work even when the receipt object is absent, and a later run deletes only that prefix without reconstructing the Quote. Derived mesh and drawing-thumbnail work is queued after commit and cannot roll back the Quote.

### Storage buckets

WordPress writes submissions to a dedicated intake bucket that holds only `intake/{session_id}/...`. The ERP reads, validates, and finally deletes the prefix there, but never writes to it. Canonical Quote files (`quote-parts/...`) and protected audit archives (`rfq-intake-archives/...`) live in the application bucket (`S3_BUCKET`), which is also what `attachments.s3_bucket` records.

Storage is therefore two adapter interfaces: `RfqIntakeStorage` (list, head, read, readJson, deletePrefix) and `RfqCanonicalStorage` (head, uploadStream, copyFromIntake). The intake bucket is configured by `INTAKE_S3_ENDPOINT`, `INTAKE_S3_REGION`, `INTAKE_S3_ACCESS_KEY_ID`, `INTAKE_S3_SECRET_ACCESS_KEY`, and `INTAKE_S3_BUCKET`, so it may sit in a different account or provider than the application bucket.

When RFQ intake is enabled, both the web process and the Worker receive those five `INTAKE_S3_*` settings (or their corresponding `*_FILE` variants). The web process uses read/list intake credentials only to run the signed-in user's manual Sync RFQs scan from the Quotes page and enqueue newly discovered receipts. It does not import submissions, write canonical objects, or delete intake prefixes. The Worker remains the sole importer, canonical-storage writer, and intake-prefix deleter.

Manual sync lists the full intake prefix, as does scheduled discovery. A shared, atomic 30-second cooldown across users and web instances bounds repeated scan cost, although scan cost still grows with abandoned intake prefixes.

`copyFromIntake` picks its strategy per object. When the intake and application clients share endpoint, region, and access key, and the object is at most 5 GiB, it issues a server-side `CopyObject`. Otherwise it streams `GetObject` into a multipart upload through the Worker. Both paths are verified by the importer's size check on the canonical object, and the chosen strategy is logged once per Worker process.

## Consequences

- Callers learn one import interface and never reproduce validation, retries, or persistence order.
- S3 objects prepared before a failed transaction may remain temporarily, but deterministic destinations make retry safe.
- The audit archive duplicates raw intake storage intentionally and is protected from ordinary deletion.
- Worker throughput is deliberately limited until production volume justifies broader concurrency.
- The integration is disabled by default through `RFQ_INTAKE_ENABLED` and requires environment-specific webhook and S3 credentials. Intake credentials should be permission-scoped by process: read/list for web, and read/list/delete for the Worker.
