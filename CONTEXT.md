# Subtract Manufacturing Admin Dashboard

Internal admin application for Subtract Manufacturing operations: CRM, quoting, order fulfillment, CAD/part assets, outbound email, and platform configuration. This document defines domain vocabulary for architecture discussions and AI navigation.

## Language

**Customer**:
An Organization with an Account of type `customer`: a business, or an individual buyer stored as a thin Organization with one Contact. Receives Quotes and places Orders. See [ADR-0013](docs/adr/0013-organizations-contacts-accounts.md).
_Avoid_: Client, buyer, account (on its own)

**Organization**:
The shared record for a business (`kind = business`) or an individual buyer (`kind = individual`). It holds Contacts, addresses, attachments, and communications, and has a customer account, a vendor account, or both. Staff see it as a Customer or a Vendor; it has no page of its own yet.
_Avoid_: Company (in code), tenant

**Contact**:
A person at one or more Organizations, with a primary email, aliases, phone, and title. A Contact is a CRM record, not an authenticated user.
_Avoid_: User (that is a staff login), member

**Account**:
A role an Organization plays, stored in `accounts` with `type` `customer` or `vendor` (at most one of each per Organization). Holds payment terms and a fixed billing address; vendor accounts also hold the Discord id. Quotes, Orders, and Parts reference a customer account; Quotes and Orders reference a vendor account when a Vendor is assigned. "Customer account" and "vendor account" mean an Account of that type.
_Avoid_: Profile, using "account" for a staff login

**Email alias**:
A normalized email a Contact is known by, stored in `contact_email_aliases` (the primary email is kept there too). RFQ intake matches an incoming email against primary emails and aliases of active Contacts, then uses their Organization's customer account. Normalization is `normalizeEmail`; plus-tags and gmail dots are never stripped.
_Avoid_: Secondary email, alternate email

**Organization merge**:
Folding one Organization into another: its Contacts join the survivor (shared ones collapse), its addresses move, each of its accounts folds into the survivor's account of that type or becomes it, and its files, communications, Notes and Event logs move. The merged Organization is soft-archived with `merged_into_organization_id`; chains resolve to the final active survivor. This is how two people at one company become one Customer with two Contacts. Admin and Dev only, at `/customers/merge` (`organization.merge`).
_Avoid_: Customer merge (merging happens at the Organization), delete duplicate, dedupe

**Contact merge**:
Combining two Contacts that are the same person: emails become aliases of the survivor, Organization links combine, and the merged Contact is archived with `merged_into_contact_id`. Offered from the Customer and Vendor pages (`contact.merge`).
_Avoid_: Merging a person with a company (that is an Organization merge)

**Duplicate suggestion**:
A pair of active Organizations the merge tool suggests reviewing, with the signals they share (same email or alias, same business email domain, phone digits, company name, or contact name) and a score that adds those signals up (email counts most). Free mailbox domains never count as a shared domain. Suggestions can be scoped to Customers, Vendors, or both, are ranked best first, and can be filtered to pairs that share every selected signal. Nothing is stored: suggestions are recomputed on each visit, and a pair that is not a duplicate is simply left unmerged.
_Avoid_: Duplicate group (suggestions are pairs, never chained groups), Customer match (that is the Action Item below)

**Customer match review**:
An Action Item raised when an RFQ email matched Contacts of several active customer accounts. It links into the merge tool and resolves itself once the candidates are merged or no longer active; an Admin or Dev resolves it by hand ("Not duplicates") when the Customers are genuinely distinct.

**Vendor**:
An Organization with an Account of type `vendor`: a shop or supplier that fulfills production work. May be assigned to quotes and orders.
_Avoid_: Supplier (unless referring to external procurement), shop (use only for production context)

**Job Board**:
The Discord channel where Vendors see Orders that still need a shop. "Job" is only used in this name; the work itself remains an Order.
_Avoid_: Jobs channel, shop board

**Job board post**:
A Discord message announcing one Order on the Job Board. The files shops need are attached to that message.
_Avoid_: Job (the Order itself), shop notification

**Claimed**:
A Job board post whose Order has been assigned to a Vendor. The post is edited to name that Vendor.
_Avoid_: Taken, awarded

**Mark as sent**:
The choice to move an Order to Waiting for Shop Selection without posting it to the Job Board.
_Avoid_: Skip Discord, manual send

**NDA required**:
Work that must not be posted on social media. Shops on the Job Board are already cleared for it.
_Avoid_: Confidential, secret

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

**Current CAD revision**:
The CAD file a Part is on now. Older revisions remain on the Part.
_Avoid_: Latest model, part file

**Attachment**:
An S3-backed file linked to an Organization (whichever role it acts in), a Quote, or an Order. May be user upload, generated PDF, or system artifact.
_Avoid_: File, document (unless PDF context)

**Note**:
A normalized text entry on an entity (quote, order, customer account, vendor account) stored in the `notes` table. Replaces legacy JSON notes on the `orders.notes` column.
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
| Customers, Vendors, Contacts, addresses | `app/lib/organizations/accounts.server.ts`, `app/lib/customers.ts`, `app/lib/vendors.ts` |
| Organization and Contact merge, duplicate detection | `app/lib/customer-merge.server.ts`, `app/routes/_protected.customers.merge.tsx` |
| Legacy backfill and reconciliation (ADR-0013 deployment 1) | `scripts/sql/organizations-backfill.sql`, `app/lib/organizations/reconciliation.server.ts` |
| Email normalization | `app/lib/email-normalize.ts` |
| Intake Customer resolution | `app/lib/rfq-intake/customer-resolution.server.ts` |
| Order CRUD | `app/lib/orders.ts`, `app/routes/_protected.orders.$orderId.tsx` |
| Order line items | `app/lib/lineItems.ts` |
| Quote line items | `app/lib/quotes.ts` (also `app/lib/line-items.ts` for email resolver — consolidation planned) |
| Email | `app/lib/email/` |
| Async jobs | `app/lib/queue/`, `scripts/worker.ts` |
| Schema | `app/lib/db/schema.ts` |
| Feature flags | `app/lib/featureFlags.ts`, `/settings` |

See [docs/architecture-map.md](docs/architecture-map.md) for the full map and [docs/adr/README.md](docs/adr/README.md) for decision backlog.
