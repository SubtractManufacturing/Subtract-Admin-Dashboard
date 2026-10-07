# ADR-0012: Customer matching at intake and merge-by-archive

## Status

Accepted

## Context

RFQ intake used to reuse a Customer only when exactly one active Customer had an identical email (trimmed and lowercased). Any other case created a new Customer, including the case where several Customers already shared the email, so the duplicate pile only grew. There was no way in the app to find or combine duplicates, and a merged Customer's email would not have matched anything afterwards.

## Decision

**Intake never creates a Customer when a match exists, and matching is email-only.** Email-domain, company-name, phone and contact-name matching are rejected for automatic intake matching because staff routinely see different mixes of them. They are used only as human-reviewed suggestions in the merge tool.

**One shared normalizer.** `normalizeEmail` (`app/lib/email-normalize.ts`) is the only definition of "the same email" for intake matching, merge detection, alias writes, and the alias backfill. It trims, applies Unicode compatibility normalization, removes zero-width and non-breaking whitespace, strips `mailto:` and angle-bracket wrappers and trailing punctuation, and lowercases. It deliberately does not strip plus-tags or gmail dots.

**Alias-based matching.** `customer_email_aliases` holds one row per (Customer, normalized email), including the primary email. Intake matches the normalized incoming email against each active Customer's primary email and its aliases. Archived Customers are never matched. Primary emails are also matched directly in SQL (trimmed, lowercased), so a Customer created outside intake after this ships still matches a clean incoming address even before it has an alias row; writing aliases from other Customer create and edit paths is a follow-up. The table is intentionally not unique on email: existing data may already contain active Customers that share an email, and the merge tool is what cleans that up. A stricter unique index is a follow-up once duplicates are merged.

**When several active Customers match,** intake attaches the Quote to the match with the most recent Quote or Order activity (ties go to the lowest id), creates no Customer, and raises a Customer match review Action Item. That item has no "Resolve" button; it links into the merge tool and resolves itself once its candidates are merged, no longer active, or confirmed "not duplicates". Manual resolve and soft-delete of an active review are both rejected.

**Merge-by-archive with a pointer.** Merging moves every record of the merged Customer (Quotes, Orders, Parts, communications, Notes, Attachments) to the survivor in one transaction, retains its emails as aliases on the survivor, then soft-archives it with `merged_into_customer_id` pointing at the survivor. The only rows removed are the merged Customer's attachment links that the survivor already has (the link table's key is Customer plus Attachment, so they collapse into one). Pointers form chains (A into B, later B into C) and resolving an archived Customer follows the chain to the final active survivor. Dismissed "not duplicate" pairs are stored as ordered (lower id, higher id) pairs.

## Consequences

- Intake behaviour is deterministic and testable through the importer's import seam; the merge module (`app/lib/customer-merge.server.ts`) is one new seam with a small interface (find groups, dismiss and un-dismiss, preview, merge).
- There is no full undo in v1. The `customers_merged` event-log entry records counts and the ids that moved so a mistake can be inspected and repaired by hand; the confirmation step previews counts so mistakes are caught beforehand.
- Merging and dismissing are restricted to Admin and Dev, enforced inside the merge module.
- Consumers of the `customer_match_review` Action Item payload must tolerate the absence of `createdCustomerId` (old items) and the presence of `attachedCustomerId`, `quoteId` and `quoteNumber` (new items).
- The migration, including backfilling `customer_email_aliases` from existing primary emails, is generated manually by the developer once the schema is final.
