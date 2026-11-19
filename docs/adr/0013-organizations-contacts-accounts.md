# ADR-0013: Organizations, contacts, and customer and vendor accounts

## Status

Accepted (2026-11-18). Deployment 1 is implemented as described below; the section **Implementation notes (deployment 1)** records where implementation refined the original proposal.

Amends [ADR-0012](0012-customer-matching-and-merge.md): email aliases move from Customers to Contacts, and merging moves to Organizations and Contacts. Intake matching rules are unchanged. A later ADR (roadmap step 3) replaces ADR-0012 in full.

## Context

`customers` and `vendors` each hold a company, one person, two addresses, and payment terms on a single row. Several people at one business become several Customers, so the merge tool can only combine them into one row and has to drop all but one person. A business that is both a customer and a vendor exists twice with nothing linking the two.

Quotes, Orders, and Parts reference `customers.id`, as do `customer_email_aliases`, `customer_attachments`, and `customer_communications`. Notes, Event logs, and Action Items reference Customers and Vendors through a polymorphic `entityType` / `entityId` pair. Customer match review Action Items store integer Customer ids in their metadata.

Roadmap #196 needs a business and the people at it to be separate records before portals exist, and portal URLs need opaque ids. Production holds about 160 Customers, so the backfill is small enough to check row by row.

## Decision

### Model

| Table | Holds |
|-------|-------|
| `organizations` | A business, or an individual buyer. `kind` is `business` or `individual`. Name, phone, website. `merged_into_organization_id`. |
| `contacts` | A person: name, title, primary email, phone. `merged_into_contact_id`. A Contact is not an authenticated user. |
| `organization_contacts` | Which Contacts belong to which Organizations, with a per-organization role or title and `is_primary`. A Contact may belong to several Organizations. |
| `contact_email_aliases` | Replaces `customer_email_aliases`, keyed by Contact. The primary email is kept here too. |
| `addresses` | Many per Organization: label, street, city, state, postal code, country. `is_default_shipping` marks at most one per Organization. |
| `accounts` | A role an Organization plays. `type` is `customer` or `vendor`, unique on (`organization_id`, `type`). Payment terms and `billing_address_id`. Vendor-only fields (Discord id, the legacy free-text address and notes) are nullable columns that only vendor accounts use. |

Every new entity table (`organizations`, `contacts`, `organization_contacts`, `addresses`, `accounts`, `organization_communications`) has a uuid primary key (`gen_random_uuid()`) and `is_archived`. The two pure link tables, `contact_email_aliases` and `organization_attachments`, keep composite keys like the tables they replace. Existing tables keep their integer and uuid keys.

**Customers and Vendors share one data model and have separate UI.** A Customer is an account of type `customer`, and a Vendor is an account of type `vendor`; the Customers and Vendors pages each list their own type. "Organization" is the shared record underneath and does not get its own page until step 3.

**Two axes, not one type.** `organizations.kind` says who the record is (`individual` or `business`). `accounts.type` says what role it plays (`customer` or `vendor`). A single three-value type (`individual | customer | vendor`) was rejected: it can't represent an individual who is a vendor, such as a one-person shop on the Job Board, or a business that is both a customer and a vendor without two copies of the business.

**An individual is a thin Organization** of kind `individual` with one Contact. Every Quote and Order then points at an account under an Organization, and no code needs a second path for people without a company. When an individual turns out to work for a business, staff merge the individual Organization into the business one and the Contact joins it.

**Foreign keys point at the account, not the Organization.** `quotes`, `orders`, and `parts` get `customer_account_id`, and `quotes` and `orders` get `vendor_account_id`, all referencing `accounts`. The database enforces the account type with a composite foreign key on (`id`, `type`) against a unique key on `accounts`, so a customer reference can't point at a vendor account. Terms are one join away.

**Files and history belong to the Organization.** `organization_attachments` replaces `customer_attachments` and `vendor_attachments`. `organization_communications` replaces `customer_communications` and adds an optional `contact_id`. An NDA or a certificate belongs to the company whichever role it is acting in.

**The billing address is fixed on the account,** and shipping addresses are a list on the Organization with one default. Quotes and Orders keep using the default shipping address, as they use the single one today. Choosing a ship-to address per Order is a follow-up; the model allows it without another migration of existing data.

### Ids

New records use uuids, and staff and portal URLs use them: `/customers/{customerAccountId}`, `/vendors/{vendorAccountId}`.

`organizations` and `accounts` keep `legacy_customer_id` or `legacy_vendor_id` (unique where set). These columns exist for the backfill, for remapping polymorphic references, for the reconciliation check, and so old `/customers/123` links redirect. No new code reads them for anything else.

### Backfill: one row in, one row out

Each `customers` row becomes one Organization, one Contact, one `organization_contacts` link marked primary, an account of type `customer`, a billing address, and a default shipping address when one is set. Each `vendors` row becomes the same with an account of type `vendor`. Nothing is grouped by company name or email domain, in line with ADR-0012.

- `kind` is `business` when `company_name` is set, otherwise `individual`.
- The Organization's name is `company_name`, falling back to `display_name`.
- Every `customer_email_aliases` row moves to the Contact.
- Archived rows are carried over archived. `merged_into_customer_id` becomes `merged_into_organization_id` on the mapped Organization, so merge chains still resolve.
- Polymorphic rows with `entityType` `customer` or `vendor` are rewritten to the matching `accounts` uuid. Customer match review Action Items that are still active have their metadata ids rewritten. Resolved ones are left as they are, and their links resolve through the legacy redirect.

The backfill is written as hand-authored SQL in the feature migration, so production is migrated before the new code serves a request. The same SQL is available as an idempotent script for dev and test databases, because those sync with `db:push`. It is keyed on the legacy ids, so running it twice changes nothing.

### Cutover in two deployments

Each deployment is one PR with many commits.

1. **Cutover.** Add the new tables and the nullable new foreign-key columns, then run the backfill. All application code reads and writes the new model from this release. The old tables and columns stay in place, untouched, as a reference copy. This release also ships the merge tooling and the reconciliation page described below.
2. **Contract.** Once the reconciliation page is clean, make the new foreign keys `NOT NULL` and drop `customers`, `vendors`, `customer_email_aliases`, `customer_attachments`, `vendor_attachments`, `customer_communications`, and the old foreign-key columns. The migration checks the mapping itself and aborts if any legacy row is unmapped (the row-by-row checks of the reconciliation page, not raw counts, which work done after cutover changes legitimately). It also purges attachments that deployment 1 kept only because a legacy link still referenced them.

A third deployment is used only if the reconciliation turns up something that needs a code fix before the old tables can go.

After deployment 1, a rollback to the previous release would lose writes made on the new model, so problems are fixed forward. The old tables still hold the state as of cutover for anything that needs repairing by hand.

### Reconciliation page

Admins and Devs get a page that checks every legacy Customer and Vendor against its new records:

- The Organization, Contact, account, and addresses exist.
- Name, email, phone, address fields, and terms match.
- Every legacy Quote, Order, Part, email alias, attachment link, and communication maps to its new link, row by row: the mapped account, or the account it ended up in after a merge.
- No Note, Event log, or Action Item of type `customer` or `vendor` still holds an integer id, and active Customer match reviews hold account uuids.

Comparing counts was rejected: new Quotes, merges, and edits after cutover change counts legitimately, and rewriting polymorphic rows in place removes the legacy id a count would need. A finding is a **mismatch** when the backfill missed or mis-mapped something, and **information** when work in the app after cutover explains it (a record changed after the backfill's cutover marker, a file removed in the app) or the legacy row was already orphaned. Each finding is listed with a link to the record. The page says the old tables are safe to drop only when there are no mismatches. It lives at `/customers/reconciliation` for Admin and Dev (`reconciliation.view`), outside the flag-gated Admin Console. It reads the legacy tables, so it is removed in deployment 2.

### Merging

Merge-by-archive from ADR-0012 now works on two record types.

- **Organization merge** (A into B). A's Contacts join B, and links B already has collapse into one. A's addresses move to B. A's customer account is folded into B's, or becomes B's when B has none: Quotes, Orders, and Parts move, and B's terms and billing address are kept unless staff pick A's in the preview. The vendor account is handled the same way. Attachments, communications, Notes, and Event logs move. A and its accounts are archived, and A gets `merged_into_organization_id = B`. This is how two people at one company end up as one Customer with two Contacts, and how an individual joins a business.
- **Contact merge** (the same person twice). Emails become aliases on the survivor, Organization links are combined, and the merged Contact is archived with `merged_into_contact_id`.

Duplicate suggestions keep the signals from ADR-0012 and add a shared email domain between Contacts, excluding free email providers. Shared domains are the strongest signal that two Customers are two people at one business. Domains still only suggest; nothing merges automatically. The preview shows counts and lets staff choose which side's fields survive before confirming. Merging stays restricted to Admin and Dev, now through `authorize()` actions instead of inline role checks.

### Intake

RFQ intake matches the normalized email against active Contacts and their aliases, then resolves the Contact's Organization's customer account. When nothing matches, it creates an Organization (`business` if the form gave a company, otherwise `individual`), a Contact, and a customer account, as it creates a Customer today. When the email matches several accounts, the existing rule applies: attach the Quote to the one with the most recent Quote or Order activity and raise a Customer match review. That can now also happen when one Contact belongs to two customer Organizations.

### Unchanged on the outside

- Email merge tokens keep their keys. `customerName` resolves to the Organization name. `customerEmail` and `customerPhone` come from the primary Contact. The address tokens come from the account's billing address and the default shipping address. `customerCompanyName` is empty for an individual.
- Bulk CSV import and export for Customers and Vendors keep their columns. Each row maps to an Organization, its primary Contact, its account, and its addresses.
- Stripe checkout writes addresses back to the account's billing address and the default shipping address.

## Consequences

- Several people per business, and a business acting as both customer and vendor, can be represented. Neither needs portal accounts.
- The single-release cutover touches most Customer and Vendor code, around 100 files. Tests and the reconciliation page carry the safety that a long dual-write period would otherwise carry.
- Merge tooling gets more important: right after the backfill, every former Customer is its own Organization, and companies come together only through merges a person reviews.
- Organization membership (Contacts or users with access to an Organization), per-Order ship-to selection, Contacts linked to Quotes or Orders, and organization-centric CRM views are out of scope here (roadmap steps 3 and 6).
- `CONTEXT.md` gains Organization, Contact, Customer account, and Vendor account, and Customer and Vendor are redefined in those terms.

## Implementation notes (deployment 1)

- **Composite foreign keys need a type column.** `quotes`, `orders`, and `parts` carry `customer_account_type` (and `vendor_account_type`), defaulted and checked to the one allowed value, so the foreign key on (`*_account_id`, `*_account_type`) can target `accounts (id, type)`, a unique constraint rather than a unique index so the DDL orders correctly.
- **One change to a legacy column.** `quotes.customer_id` drops `NOT NULL`: new Quotes no longer write the legacy columns. No other legacy table or column changes, and new code never writes them. Their TypeScript names carry a `legacy` prefix so the compiler finds any remaining use.
- **Backfill details.** The legacy phone goes on the Contact (the Organization phone starts empty). The Contact's name is `contact_name`, falling back to `display_name` unless it only repeats the company. A billing address is created only when one is filled in. Contacts of archived legacy rows are archived. Communications keep their ids. Every primary email, normalized, is also an alias, for Vendors too. Active match reviews keep their integer ids under `legacy*` keys. The SQL takes an advisory lock so concurrent runs serialize, and writes one `organizations_backfilled` event as the cutover marker.
- **Legacy attachment links still hold foreign keys.** Until deployment 2, removing a file that `customer_attachments` or `vendor_attachments` references only unlinks it from the Organization; the file and its row stay.
- **Writes are partial.** A profile write changes only the fields it names; Organization, primary Contact, billing address, default shipping address, and account each get their own columns. Legacy `displayName` / `companyName` input (bulk import, quick-create forms) maps the way the backfill does; a rename alone keeps the Organization's kind.
- **Merging.** When B lacks an account type that A has, A's account moves to B with its id, so its links and URL keep working. When both have it, A's records fold into B's account and A's account is archived. Shared files link once, one default shipping address survives (staff choose which), and B's primary Contact stays primary unless staff pick A's. When an individual joins a business, the preview pre-selects the business's name and type. A shared business email domain weighs 50 (email 100, phone 45, company 35, contact name 30). Suggestions can be scoped to Customers, Vendors, or both. Contact merges are offered on the Customer and Vendor pages, with duplicate Contacts on one Organization flagged.
- **Intake.** A single match fills only the matched Contact's blank name and phone and never changes the Organization's name or kind; staff merge instead. When the matched Contact's only Organization has no customer account (a Vendor sending an RFQ), intake adds one to it rather than creating a second Organization.
- **Ids outside the app.** The `rfq.imported` webhook's `customerId` and the Stripe payment link metadata's `customerId` are now customer account uuids.

