# ADR-0011: WordPress RFQ intake module

## Status

Accepted

## Context

WordPress RFQ submissions can be discovered by a webhook or an S3 scanner and retried manually. The importer must remain idempotent under concurrent discovery, prepare multi-gigabyte files without buffering them, expose no partial Quote, and distinguish package failures from infrastructure failures and post-commit cleanup failures.

## Decision

RFQ intake is a deep module whose external behavioral interface is `importReceipt(receiptKey) -> ImportOutcome`. Webhook, scanner, Worker, manual retry, and tests use that interface or enqueue the same receipt pointer.

The module owns package validation, deterministic canonical keys, streamed ZIP64 audit archives, retry classification, and cleanup-only recovery. Storage, queue, clock, and persistence are adapters at internal seams. Production uses AWS SDK, pg-boss, and Postgres adapters; tests use controlled in-memory adapters, and the storage contract also runs against MinIO.

S3 preparation happens before the short Postgres transaction. The transaction matches or creates the Customer and atomically inserts the Quote, QuoteParts, line items, Attachments, Notes, audit events, Action Items, and completed ledger state. Database uniqueness on receipt number and Quote source receipt number is the final idempotency guard. The Worker processes one RFQ import at a time per process; the ledger owns bounded retry timing rather than pg-boss.

If the database commit succeeds but intake-prefix deletion fails, the ledger enters `cleanup_pending`. A later run deletes only that prefix and never reconstructs the Quote. Derived mesh and thumbnail work is queued after commit and cannot roll back the Quote.

## Consequences

- Callers learn one import interface and never reproduce validation, retries, or persistence order.
- S3 objects prepared before a failed transaction may remain temporarily, but deterministic destinations make retry safe.
- The audit archive duplicates raw intake storage intentionally and is protected from ordinary deletion.
- Worker throughput is deliberately limited until production volume justifies broader concurrency.
- The integration is disabled by default through `RFQ_INTAKE_ENABLED` and requires environment-specific webhook and S3 credentials.
