# ADR-0014: Staged cutover to Organizations

## Status

Accepted (2026-11-23).

Replaces the rollout parts of [ADR-0013](0013-organizations-contacts-accounts.md): **Backfill** (where it says the backfill runs in the feature migration), **Cutover in two deployments**, **Reconciliation page**, and the statement that problems are fixed forward. The data model, merging, and intake rules of ADR-0013 are unchanged.

## Context

ADR-0013 cut over in one release: the migration backfilled the new tables and all code read and wrote them from that moment. A rollback after staff had used the release would have lost their work, so the plan was to fix forward.

That is not safe enough. The cutover has to let the business keep operating, stop at any point, show its state at any time, and go back to the old system without losing data. It also has to be simple enough to explain in a few sentences.

## Decision

### The rule

**Until Unlock is pressed, the old tables are complete and current.** The previous release can be put back at any moment and nothing staff entered is missing.

Everything below exists to keep that rule true or to show that it is true.

### Stages

| Stage | Release | Staff use | Data | Going back |
|-------|---------|-----------|------|------------|
| **Shadow** | A | Today's app, unchanged | New tables and columns are added and filled as a copy. The copy changes no existing row. Admins correct names on the review list and plan merges (see **Review before Switch**). | Nothing to undo |
| **Switch** | B | New app on the new tables, limited to what the old app could store | Every save writes the new tables and the old ones in one transaction | Redeploy release A |
| **Unlock** | B (a button) | New app with Contacts, addresses, and merging enabled | Polymorphic ids are rekeyed to account uuids. Writes to the old tables stop. The approved merge plan is applied. | Restore only. The old tables stay as a snapshot of the moment of Unlock. |
| **Clean up** | C | Same | Old tables and columns are dropped | n/a |

Unlock is the only one-way step. Shadow and Switch can last as long as needed, and Switch can be left and re-entered any number of times.

The stage is one row in the database. Every change of stage writes an Event log with who made it.

### What changes in the data, in order

1. **Add** (release A migration). New tables, the nullable `*_account_id` columns, and `quotes.customer_id` drops `NOT NULL`. Schema only; the migration contains no data statements.
2. **Copy** (Sync, Shadow). Each `customers` or `vendors` row becomes one Organization, one Contact, one account, and up to two addresses. Quotes, Orders, and Parts get the account id beside the old id. Old columns are not touched.
3. **Double save** (Switch). New and old are written together.
4. **Rekey** (Unlock). Notes, Event logs, Action Items, and active Customer match reviews move from integer ids to account uuids. This is the first time the cutover changes an existing row in place.
5. **Group** (Unlock). The planned merges approved during review are applied, behind the maintenance gate, so staff first see the grouped Organizations complete.
6. **Drop** (release C migration).

### One mapping, three users

The mapping from an old row to its new records is defined once, as ADR-0013's backfill rules. Three things use it:

- **Sync** (Shadow only) makes the new records equal to what the mapping says for every old row. It inserts missing rows and overwrites copied ones, so it picks up edits, merges, and archives made in the old app. Account uuids are keyed on the legacy id and never change between runs. Sync is disabled in Switch, where it would overwrite the live side.
- **Check** (any stage before Unlock) reports every place where a Sync would change something: per old row, field by field, plus aliases, files, communications, merge pointers, and the Quote, Order, and Part links. "0 differences" is the precondition for Switch and for Unlock.
- **The double save** (Switch only) keeps Check at 0 differences after every save. It changes an old column only when the save changed the value that column maps to. `display_name`, `company_name`, and `contact_name` fall back to each other in the mapping, so before changing one of them the double save writes the others explicitly.

| New record | Old home |
|------------|----------|
| Organization name and kind | `display_name`, `company_name` (`business` when `company_name` is set) |
| Primary Contact name, title, email, phone | `contact_name`, `title`, `email`, `phone` |
| Contact email aliases | `customer_email_aliases` (Customers). Vendors have none; extra Vendor aliases stay in the new tables and the old app never used them. |
| Account billing address, default shipping address | `billing_*`, `shipping_*` |
| Account terms, Discord id, legacy address, notes, archived | `payment_terms`, `discord_id`, `address`, `notes`, `is_archived` |
| New account | New `customers` or `vendors` row; its id is stored as the account's legacy id |
| `customer_account_id`, `vendor_account_id` on Quotes, Orders, Parts | `customer_id`, `vendor_id` |
| Organization files | `customer_attachments`, `vendor_attachments` |
| Organization communications | `customer_communications` (same id) |
| Notes, Event logs, Action Items, match review metadata | Keep the legacy integer id until Unlock. The new code translates through the account's legacy id. |
| Ids that leave the app (Stripe payment link metadata, `rfq.imported` webhook) | Stay legacy integers until Unlock |

### Review before Switch

The mapping is mechanical and the old data is not uniform. Some display names read "Business - Person", some rows have no company name, and several people at one business are separate Customers. A person decides how each record should come out, before staff see the new app. The status page carries a review list and a groups list.

**Names and types.** About half of the active Customers in production carry only a `display_name` (a company, a person, or both combined) with `company_name` and `contact_name` empty. Left alone, the mapping turns each of them into an individual named after the display name. Release A ships a review list to correct them, so the pass happens in Shadow while staff keep using the old app.

- **One row per old Customer or Vendor,** showing the display name, company, contact, and email beside the Organization name, type, and Contact the mapping gives. The result updates as the reviewer types.
- **Flags** mark the rows that look wrong: no company name where the display name or the email domain suggests a business, a display name that combines company and person, a Contact that would be named after the display name, a contact name that repeats the company, no email. [`scripts/sql/organizations-precheck.sql`](../../scripts/sql/organizations-precheck.sql) is the same list as a read-only query, for looking before release A exists.
- **Suggestions** fill the fields for a flagged row and are never saved without the reviewer: the display name as the company, a combined name split into company and person, a first name read from the email address offered as a hint.
- **The reviewer edits company, contact, and display name in the row and saves,** or marks the row as right. A field can be cleared. The list filters to flagged or unreviewed rows and shows progress.
- **A save corrects the old row** through the old app's own update path, with the same Event log, and the copy follows on the next Sync. This is the only way the cutover tooling changes an old row, and each change is one a person made. Staff see the corrected fields in the old app.
- **A reviewed mark** is kept per row and resets when the old row later changes in a way that changes its result.

An override table beside the copy was rejected: it would make old and new disagree on purpose, which is the condition Check exists to rule out. Fixing through the bulk import was rejected as too indirect for this many rows.

**Groups.** Which records are one Organization: two people at one business, or a Customer and a Vendor that are the same company. The old tables cannot hold a group, so nothing is merged before Unlock. Each group is saved as a planned merge with its survivor, members, field choices, and approver.

- Suggestions use ADR-0013's signals. Nothing is grouped without a person approving it.
- The list previews the result: how many Organizations and Contacts there will be after Unlock.
- Unlock applies the approved plan with the ordinary merge code. A planned merge whose records changed since approval is held back for another look, not applied.

Switch requires every row on the review list to be marked reviewed. The groups list can be finished during Switch.

Two people at one business are not merged with the old merge tool during the pass: it keeps one person and drops the other. They go on the groups list. The same person entered twice can be merged in the old app as today.

### Locked during Switch

The old tables cannot hold these, so they are refused on the server (not just hidden) until Unlock:

- a second Contact on an Organization, removing or re-pointing the primary Contact, Contact merges, and a Contact shared by two Organizations;
- any address beyond the billing and default shipping address, and re-pointing either role to another address;
- an Organization holding both a customer and a vendor account (intake creates a separate Organization, as the old app would);
- Organization merges, including the Customer merge the old app has today;
- fields with no old column: Organization website and main phone, a Contact's role, address labels, and communications on a Vendor.

Merges that cannot wait are done in Shadow with the existing merge tool.

### The status page

One page for Admin and Dev, present in releases A and B, through `authorize()`. It shows the stage, which tables are live, the last Sync, and the Check result with a link to each differing record. It offers only the actions valid for the stage:

- **Shadow (release A):** Sync, Check, the review list, and the groups list.
- **Release B while the stage is Shadow:** staff see a maintenance page, RFQ intake is paused, and inbound webhooks answer 503 so the sender retries. Sync, Check, and **Switch** (enabled at 0 differences with every row reviewed).
- **Switch:** Check, repair one old row from its new records, the groups list, and **Unlock** (enabled at 0 differences, with a typed confirmation). Unlock raises the maintenance gate, rekeys, applies the merge plan, reports what was applied and what was held back, and lowers the gate.

Release A records the stage as Shadow every time it starts. That is what makes a redeploy of release A a complete rollback: the next start of release B waits behind the gate for a Sync and a Check.

RFQ intake also gets a permanent `rfq_intake_enabled` flag, so intake can be paused by hand at any stage.

### Releases

- **Release A** is built off `master` in two PRs, and no existing code path changes in either. Part 1 is the schema, Sync, Check, the stage row, the status page, and the review list. Part 2 is the groups list. Part 1 ships first so the names pass can start. The last release A version is the one a rollback returns to, so it must be published as its own release.
- **Release B** is PR #202 rebased on A, plus the double save, the locks, the legacy-id translation, the gate, Switch, and Unlock. It ships no migration, so release A's image runs against the same schema.
- **Release C** drops the old tables and columns, makes the new foreign keys `NOT NULL`, and removes the cutover code. Its migration aborts unless the stage is Unlocked.

Rolling back from Switch means setting the image tag in the infra repo's `docker-compose.yml` back to release A's version; DOCO-CD deploys it. If other work has been released since, revert PR B on `master` and release that instead.

### Tests that hold the rule

- **Mapping:** for generated old rows, Sync then Check gives 0 differences, and a second Sync changes nothing.
- **Double save:** after every write the new app can make in Switch, Check gives 0 differences and no unrelated old column changed.
- **Round trip:** Shadow, Switch with writes, back to Shadow with old-style writes, Sync, Switch again. Check is 0 at each step and account uuids are stable.
- **The old app really works:** release A's integration suite runs against a database that has been through Switch-stage writes.
- **Locks:** every locked action is refused on the server in Switch.
- **Write paths:** a test fails if code outside the Organizations module writes the new tables, so no save can skip the double save.
- **Review:** the review list and the precheck query flag the same rows and show the same result; a save changes only the fields the reviewer edited and writes an Event log; a reviewed mark resets when the row's result changes; a stale planned merge is held back.
- **Unlock and Clean up:** the rekey is complete, the approved merge plan gives the previewed result, and release C's migration refuses to run before Unlock.

Before each production step, the same step is rehearsed on a restored copy of production in a throwaway database.

### Runbook

1. Rehearse the whole sequence on a restored production copy.
2. Release A. Run Sync and read Check. Work through the review list until every row is reviewed, and start the groups list. Stay here as long as needed.
3. Take a database snapshot. Release B. Behind the gate: Sync, Check at 0, click through a few Customers, a Quote, and an Order as Admin, then Switch. Turn intake on.
4. Soak. Read Check daily. To go back: redeploy release A.
5. When the exit criteria are met and the groups list is finished: take a snapshot, then Unlock.
6. Release C once nothing needs the old tables.

## Consequences

- Rollback from Switch loses nothing, and the old system is the real previous release, not an emulation of it.
- The first release changes nothing staff can see, and the copy can be inspected in production before anything depends on it.
- Organizations are configured by a person before staff see them. Names and types are right at Switch, and the grouped Organizations appear complete at Unlock.
- During Switch staff still see one record per old Customer, as today. Two people at one business show as two rows with the same Organization name and different Contacts. Grouping cannot come earlier without giving up the rollback.
- `display_name` has no place in the new model. Lists, emails, and documents show the Organization name from Switch on.
- Staff cannot merge or use the new Contact and address features during Switch.
- Each move into Switch needs a maintenance window of a few minutes.
- The double save, the locks, the id translation, and the status page are temporary code, removed in release C.
- A bug in the double save could write a wrong value to an old row. Check, the write-path test, and the snapshot before Switch are the defences.
- ADR-0013's reconciliation page is replaced by Check. Its distinction between mismatches and changes made after cutover is no longer needed, because old and new stay equal until Unlock.

## Open questions

Questions 1 and 5 are settled as proposed. Questions 2, 3, and 4 must be answered before Switch; none of them blocks release A.

1. **Exit criteria for Unlock.** Proposed: five working days in Switch with Check at 0, and at least one RFQ import, one Quote converted to an Order, and one Stripe checkout completed.
2. **Other releases during Switch.** Either hold other merges to `master` during the soak, or accept that rollback is then a revert of PR B instead of a tag change.
3. **Snapshots.** Who takes the database snapshot before Switch and before Unlock, and with what.
4. **Rehearsal environment.** The staging deploy step is a placeholder, so rehearsal is assumed to run on a locally restored copy.
5. **Unlock as a button or a release.** Proposed: a button in release B. A separate release would keep the button out of production during the soak.
