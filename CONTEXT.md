# Subtract Manufacturing Admin Dashboard

Internal admin application for Subtract Manufacturing operations: CRM, quoting, order fulfillment, CAD/part assets, outbound email, and platform configuration. This document defines domain vocabulary for architecture discussions and AI navigation.

## Language

**Customer**:
A person or organization that receives quotes and places orders. Stored with structured billing and shipping addresses.
_Avoid_: Client, buyer, account

**Vendor**:
A shop or supplier that fulfills production work. May be assigned to quotes and orders.
_Avoid_: Supplier (unless referring to external procurement), shop (use only for production context)

**Quote**:
A priced offer sent to a Customer before work becomes an Order. Identified by quote number; may include QuoteParts, QuoteLineItems, attachments, and delivery estimates.
_Avoid_: Estimate, proposal, RFQ (RFQ is a status, not the entity)

**Quote status lifecycle**:
`RFQ` → `Draft` → `Sent` → (`Accepted` | `Rejected` | `Dropped` | `Expired`). Accepted or Sent quotes may convert to an Order.
_Avoid_: Treating "RFQ" as a separate entity type

**Order**:
Work in progress or completed fulfillment for a Customer. Created manually or by converting an accepted Quote. Identified by order number (`YY[LETTER][5-DIGIT]`, e.g. `25Z00001`).
_Avoid_: Purchase, transaction, job

**Order status lifecycle**:
`Pending` → `Waiting_For_Shop_Selection` → `In_Production` → `In_Inspection` → `Shipped` → `Delivered` → `Completed` (or `Cancelled` / `Archived`).
_Avoid_: Mixing "Shipped" with delivery completion — use `Delivered` for customer receipt

**Line item**:
A priced row on a Quote or Order — quantity, unit price, optional Part link, notes. Quote line items reference QuoteParts; order line items reference Parts.
_Avoid_: Line-items (file name), SKU (unless inventory context)

**QuotePart**:
A part specification on a Quote before conversion — CAD file, mesh, Toolpath data, and drawings. Becomes a customer Part when a Quote converts to an Order.
_Avoid_: Quote part (two words in prose), Part (until converted)

**Part**:
A customer-owned CAD asset (STEP, mesh, drawings) linked to Orders via line items. Distinct from QuotePart until quote conversion copies assets.
_Avoid_: Component, SKU

**Attachment**:
An S3-backed file linked polymorphically to customers, vendors, quotes, or orders. May be user upload, generated PDF, or system artifact.
_Avoid_: File, document (unless PDF context)

**Note**:
A normalized text entry on an entity (quote, order, customer, vendor) stored in the `notes` table. Replaces legacy JSON notes on the `orders.notes` column.
_Avoid_: order-notes (legacy module name), comment

**Outbound email**:
App-controlled email sent via Postmark — quote send, order confirmation, etc. Queued through pg-boss; may require approval workflow.
_Avoid_: Notification (unless in-app), campaign

**Sent email**:
A persisted outbound email record with status (`queued`, `sending`, `sent`, `failed`, `pending_approval`, etc.) linked to a quote, order, or invoice entity.
_Avoid_: Email log entry

**Feature flag**:
A database-backed toggle gating rollout of product behavior. Managed in Settings (Dev/Admin tabs). Distinct from user role permissions.
_Avoid_: Config setting (unless permanent developer setting)

**Soft delete**:
Archiving via `isArchived` (and optional `archivedAt` / `hardDeleteAt` on line items and parts). Records remain queryable until hard purge jobs run.
_Avoid_: Delete (without qualifier), hard delete

**Delivery date**:
The committed or estimated date range when an Order or Quote will reach the customer. Canonical field name after `shipDate` rename (v1.5.0).
_Avoid_: shipDate (deprecated merge token and legacy event fields only)

**Toolpath**:
External machinability service integration for QuoteParts — upload, report polling, cut configs. Gated by `toolpath_integration` feature flag.
_Avoid_: Tool path (two words)

**Mesh conversion**:
Async CAD-to-web-mesh pipeline (STEP → STL/OBJ/GLTF) via conversion service and `cad-conversion` pg-boss queue.
_Avoid_: Thumbnail generation (separate concern)

**Admin Console**:
Elevated UI at `/admin/*` — users, email templates, Stripe settings, data retention. Gated by role and `admin_console_access` flag.
_Avoid_: Admin panel, back office

**Settings**:
User and developer configuration at `/settings` — feature flags, developer settings, Stripe defaults, dev-only tools. Overlaps Admin Console in scope; see [docs/architecture-map.md](docs/architecture-map.md).
_Avoid_: Preferences (stub tab, not implemented)

**Download**:
Unified file retrieval at `/download/*` — attachments, parts, quote bundles, S3 keys. Client code uses `useDownload()` hook.
_Avoid_: Export (bulk CSV/JSON is separate concern on same route today — see ADR backlog)

**Worker**:
Separate Node process (`scripts/worker.ts`) running pg-boss consumers for email, CAD conversion, Toolpath, and retention jobs. Required alongside `npm run dev` for async features.
_Avoid_: Background job (generic), cron

## Where to look

| Concept | Primary location |
|---------|------------------|
| Quote CRUD + conversion | `app/lib/quotes.ts`, `app/routes/_protected.quotes.$quoteId.tsx` |
| Order CRUD | `app/lib/orders.ts`, `app/routes/_protected.orders.$orderId.tsx` |
| Order line items | `app/lib/lineItems.ts` |
| Quote line items | `app/lib/quotes.ts` (also `app/lib/line-items.ts` for email resolver — consolidation planned) |
| Email | `app/lib/email/` |
| Async jobs | `app/lib/queue/`, `scripts/worker.ts` |
| Schema | `app/lib/db/schema.ts` |
| Feature flags | `app/lib/featureFlags.ts`, `/settings` |

See [docs/architecture-map.md](docs/architecture-map.md) for the full map and [docs/adr/README.md](docs/adr/README.md) for decision backlog.
