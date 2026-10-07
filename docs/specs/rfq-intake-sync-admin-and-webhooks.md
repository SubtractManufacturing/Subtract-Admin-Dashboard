# Spec: RFQ intake sync, admin submissions list, and outbound webhooks

Status: ready-for-agent. Builds on [ADR-0011](../adr/0011-wordpress-rfq-intake.md) and the dedicated-intake-bucket work in the same PR.

## Problem Statement

The WordPress RFQ intake pipeline imports submissions into Quotes automatically, but staff have almost no visibility into it and no way to nudge it.

- A staff member who knows a customer just submitted an RFQ has to wait for the webhook or the five-minute scanner. If the webhook was missed they cannot tell whether anything is wrong, and cannot ask the ERP to look again.
- The only place intake state is visible is the Action Items page, and only for failures. A successful import, a pending one, or one waiting on a scheduled retry is invisible without querying the database.
- Admins have no way to see which intake submissions exist, what state each is in, or to retry one, without using Action Items or scripts.
- Nothing outside the ERP learns that an RFQ arrived, was imported, or failed. The team wants to drive its own automation (via n8n) off those moments, without the ERP having to know what happens next.

## Solution

Three small, related additions, shipped together as one feature.

1. **Sync on the Quotes page.** Any signed-in user gets a "Sync RFQs" button. It scans the intake bucket inline, hands any new submissions to the Worker for import, and shows a banner such as "Found 2 new RFQs". While the banner is showing, the Quotes list refreshes itself so imported Quotes appear without a reload. A short shared cooldown stops repeated clicks from hammering storage.
2. **RFQ intake submissions list in the Admin Console.** Admin and Dev users see every intake submission the ledger knows about, with status, attempts, next retry, last safe error, and a link to the Quote. Failed or waiting rows can be retried immediately.
3. **Outbound webhook.** Admin and Dev users set one URL. When a submission is received, imported, or fails permanently, the ERP posts a small JSON event to that URL, fire-and-forget. A "Send test event" button verifies the URL.

## User Stories

### Sync on the Quotes page

1. As a staff member, I want a Sync RFQs button on the Quotes page, so that I can pull in a submission I know just arrived without waiting for the scheduled scan.
2. As a staff member, I want the button available to any signed-in user, so that I do not have to find an administrator to refresh RFQs.
3. As a staff member, I want the button hidden when RFQ intake is switched off for the environment, so that I am never shown a control that cannot work.
4. As a staff member, I want the click to be answered synchronously, so that I know immediately whether anything was found.
5. As a staff member, I want a banner reading "Found N new RFQs" when new submissions are detected, so that I know imports have started.
6. As a staff member, I want a brief "No new RFQs" message when nothing is new, so that the click does not feel like it did nothing.
7. As a staff member, I want the count to include only submissions that will actually start importing, so that old, already-imported RFQs do not inflate the number.
8. As a staff member, I want the count to exclude submissions waiting on a future retry, so that the banner does not promise work that will not start now.
9. As a staff member, I want the banner to be dismissible, so that it does not clutter the page.
10. As a staff member, I want the banner to disappear when I navigate away, so that stale counts are not shown later.
11. As a staff member, I want the Quotes list to refresh on its own while the banner is showing, so that new Quotes appear without me reloading.
12. As a staff member, I want that refresh to stop after about two minutes, so that an idle page does not poll forever.
13. As a staff member, I want the button disabled while a sync is in flight, so that double-clicks do nothing.
14. As a staff member, I want a "Synced just now" message when someone has synced within the last 30 seconds, so that I understand why no new scan ran.
15. As a staff member, I want that message to show the last scan's count, so that I still see what was found.
16. As a staff member, I want two people clicking at the same moment to cause one scan, so that the system is not scanned twice for no benefit.
17. As an operator, I want the cooldown shared across all users and all web instances, so that the limit holds regardless of who clicks.
18. As an operator, I want a sync to be harmless if it overlaps the scheduled scan or the webhook, so that no duplicate Quote can result.
19. As an operator, I want the sync to use the same discovery logic as the scheduled scan, so that behaviour is identical and not a second implementation.
20. As an operator, I want a sync failure (for example storage unreachable) to show a clear error banner, so that staff know to report it rather than assume there is nothing new.

### Admin submissions list

21. As an Admin or Dev user, I want a page listing every intake submission the ledger knows about, so that I can see the state of the pipeline in one place.
22. As an Admin or Dev user, I want the page in the Admin Console and linked from the admin index, so that I can find it where I expect configuration and operations pages.
23. As an Admin or Dev user, I want ordinary users to be unable to open the page, so that operator-facing details are not exposed to them.
24. As an Admin or Dev user, I want rows ordered newest first, so that the latest submissions are at the top.
25. As an Admin or Dev user, I want status filter tabs (All, In progress, Failed, Completed), so that I can jump straight to what needs attention.
26. As an Admin or Dev user, I want "In progress" to include pending, processing, retry scheduled, and cleanup pending, so that every non-terminal state is reachable in one tab.
27. As an Admin or Dev user, I want 25 rows per page with simple paging, so that the page stays fast as history grows.
28. As an Admin or Dev user, I want each row to show received time, receipt number (or the session ID when the receipt number is not yet known), status, attempt count, next retry time, and last safe error, so that I can diagnose without leaving the page.
29. As an Admin or Dev user, I want completed rows to link to their Quote, so that the page doubles as a lookup from WordPress receipt to ERP Quote.
30. As an Admin or Dev user, I want a Retry now button on failed and waiting rows, so that I can bypass a cooldown after fixing an infrastructure problem.
31. As an Admin or Dev user, I want Retry now to reset the retry schedule exactly as the existing Retry Now on Action Items does, so that there is one retry behaviour.
32. As an Admin or Dev user, I want Retry now refused for non-Admin/Dev callers even if the request is forged, so that authorisation is enforced on the server.
33. As an Admin or Dev user, I want receipt numbers shown in this list, so that I can match a submission against WordPress, while ordinary users and Quote pages continue to hide them.

### Outbound webhook

34. As an Admin or Dev user, I want to enter one webhook URL, so that the ERP can notify my automation tool.
35. As an Admin or Dev user, I want an empty URL to mean the webhook is disabled, so that there is no separate switch to forget.
36. As an Admin or Dev user, I want `https://` URLs validated with normal certificate checking, so that events are not sent over an unverified connection.
37. As an Admin or Dev user, I want `http://` URLs accepted when I type them explicitly, so that I can post to a local container or a test receiver without TLS.
38. As an Admin or Dev user, I want any other URL scheme rejected with a clear message, so that a typo cannot point the webhook somewhere unintended.
39. As an Admin or Dev user, I want the saved URL masked down to its host when displayed, so that an unguessable webhook path is not casually exposed.
40. As an Admin or Dev user, I want a Send test event button, so that I can confirm the URL works.
41. As an Admin or Dev user, I want the test result (HTTP status or error) shown on the page, so that I get feedback despite delivery otherwise being fire-and-forget.
42. As an automation owner, I want an `rfq.received` event when the ERP first records a submission, so that I can react as soon as an RFQ arrives.
43. As an automation owner, I want an `rfq.imported` event after the Quote is committed, so that I can react to a Quote that actually exists.
44. As an automation owner, I want the `rfq.imported` payload to carry the Quote identity, customer, part count, and NDA flag, so that I can route it without calling back into the ERP.
45. As an automation owner, I want an `rfq.failed` event when an import fails permanently or exhausts automatic retries, so that I can alert someone about a stuck RFQ.
46. As an automation owner, I want no event for each transient retry, so that I am not flooded while the system heals itself.
47. As an automation owner, I want each event to carry a stable `eventId`, so that I can deduplicate if I ever see one twice.
48. As an automation owner, I want each event to carry its type and occurrence time, so that I can handle them uniformly.
49. As an automation owner, I want `rfq.received` and `rfq.failed` to include the receipt number, so that I can correlate with WordPress before a Quote exists.
50. As an operator, I want a slow or dead webhook receiver to never delay, fail, or retry an RFQ import, so that notification problems cannot affect intake.
51. As an operator, I want webhook errors recorded in the server log only, so that they are diagnosable without adding another failure surface.
52. As an operator, I want a repeat trigger for an already-imported receipt to send no further events, so that n8n does not see noise.

## Implementation Decisions

### Sync

- Sync runs **inline in the web request**. The web process therefore holds the intake bucket settings (`INTAKE_S3_*`, including the secret and the `_FILE` variants) in addition to the application bucket settings it already has. This is a change to the deployment shape recorded in ADR-0011 and must be written back into it, along with the deployment README and the env-to-files conversion script.
- Sync reuses the existing receipt discovery behaviour rather than a second scan implementation. New submissions are handed to the Worker through the existing import queue; the Worker still performs every import, one at a time per Worker process.
- Discovery's outcome gains a count of **new imports**, defined as discovered submissions that will start an import now: no ledger row yet, pending, retry whose due time has arrived, or processing with an expired lease. It excludes completed submissions, cleanup-only work, submissions in a future retry window, and permanently failed submissions. The existing counters keep their meaning so the scheduled scan's logging is unchanged.
- The banner shows the new-import count. Zero shows "No new RFQs". Wording is exactly "Found N new RFQs" with correct singular/plural.
- **Cooldown:** 30 seconds, shared across all users and web instances, persisted in developer settings (last run time and last new-import count). The check-and-claim is atomic (a single conditional update), so concurrent clicks produce exactly one scan; the losers receive the winner's last result and a "Synced just now" message. There is no Admin/Dev bypass.
- Sync requires only that the user is signed in. It is a Quotes-page action.
- The button is rendered only when RFQ intake is enabled. The server also refuses a sync when intake is disabled.
- A storage or database failure during sync returns an error result that the page renders as an error banner; it does not release the cooldown claim in a way that permits an immediate hammering retry loop (a failed scan still starts the cooldown).
- While the banner is visible the Quotes list revalidates about every 10 seconds, for at most about 2 minutes, using the framework's built-in revalidation. No new endpoint or socket.

### Admin submissions list

- New Admin Console page for RFQ intake, restricted to Admin and Dev, linked from the admin index. It lives in the Admin Console, not Settings (see ADR-0008 on the Admin/Settings overlap).
- The list is backed by the **import ledger only**. It never lists the bucket, so page loads cost no storage calls and do not slow down as abandoned intake prefixes accumulate.
- Query interface: list ledger rows by status group and page, newest first, 25 per page. Status groups: All; In progress (pending, processing, retry scheduled, cleanup pending); Failed (permanent failure); Completed. Returns the total count so the page can page.
- Each row exposes: received time, receipt number if known else session ID, status, attempt count, next attempt time, latest safe error detail, and the linked Quote identity when completed.
- Rows never expose raw error internals beyond the existing safe error detail.
- **Retry now** is a new command keyed by receipt key that enforces the Admin/Dev check on the server and then delegates to the existing receipt-key retry reset used by Action Items Retry Now, so there is a single reset behaviour. It is offered on failed and waiting rows. Receipt numbers are visible here and only here, consistent with Action Item titles being operator-facing.
- Quote detail pages continue to omit the receipt number. This page does not change that rule.

### Outbound webhook

- One setting: the webhook URL, stored in developer settings and edited on the same Admin Console page. Empty means disabled. No secret, signing, or additional configuration.
- URL validation on save: must parse as a URL with scheme `http` or `https`. `http` is never rewritten or upgraded. `https` uses default certificate validation, with no option to skip it. Any other scheme is rejected with a message.
- Display masks the URL to its scheme and host once saved.
- **Events**, emitted by the Worker as part of the import lifecycle, never from the web process (except the manual test):
  - `rfq.received`: when the ledger row is first created for a receipt (the first claim by the Worker). The scan alone does not create a row, so the event fires at first claim, not at discovery. Emitted once per receipt.
  - `rfq.imported`: after the database commit that creates the Quote succeeds. Emitted once per receipt. A later cleanup-only retry or a no-op repeat trigger does not re-emit.
  - `rfq.failed`: when a receipt reaches a terminal failure, either a permanent validation failure or the end of the automatic retry schedule. Emitted once per transition, not on each transient retry and not on repeated triggers of an already-failed receipt. A Retry now that leads to a new terminal failure emits it again, since it is a new failure.
- **Envelope** (all events): `eventId` (stable unique id), `event` (type), `occurredAt` (ISO 8601), `data`.
- **Data**:
  - `rfq.received`: receipt number when readable (otherwise null), session ID.
  - `rfq.imported`: Quote ID, Quote number, Customer ID and display name, part count, NDA-required flag. The receipt number is deliberately omitted; the Quote reference replaces it.
  - `rfq.failed`: receipt number when known (otherwise null), session ID, error classification, safe error detail, attempt count.
- **Delivery is fire-and-forget.** A single HTTP POST of the JSON body with a roughly 10-second timeout, started after the relevant database commit, with every error caught and written to the server log only. No queue job, no retry, no persisted delivery record. A failed or slow receiver must not change an import outcome, retry timing, ledger state, or Action Items.
- **Send test event** is a web action available to Admin and Dev. It posts a sample envelope with event type `rfq.test` to the saved URL (or the URL currently in the field, if unsaved), and returns the HTTP status or error to the page. This is the only path that surfaces delivery results to the user.
- The webhook payload is built from importer outcomes and persisted state, not from raw manifest content, so no customer file content or free-text notes are sent.

### Module shape

- Discovery: extended outcome with the new-import count; behaviour otherwise unchanged.
- Sync command: one new function that applies the cooldown, runs discovery against the real ledger and storage, and returns the new-import count plus a cooldown flag.
- Submissions query: one new read function over the ledger.
- Retry command: one new Admin/Dev-gated function over the existing reset.
- Outbound notifier: a small port injected into the importer, with a real HTTP implementation and an in-memory implementation for tests. The importer calls it at the three lifecycle points; it knows nothing about HTTP.
- Routes: the Quotes page gains a sync action and banner; a new Admin Console route covers the list, retry, URL form, and test action.

### Schema

- No schema changes and no migration. Settings reuse developer settings; the list reads the existing ledger. If implementation discovers a missing ledger column (for example a received-at timestamp), stop and raise it rather than generating a migration; migrations are generated manually by the developer.

## Testing Decisions

- A good test here exercises behaviour through the agreed seams and asserts observable outcomes: counts returned, rows listed, events emitted, authorisation refusals. It does not assert internal call order, query shapes, or message wording beyond the exact banner strings that are part of the requirement.
- Expected values come from fixed literals and fixtures, not from re-deriving production logic in assertions.
- Work proceeds as vertical red-to-green slices, in this order: new-import count; sync command with cooldown; submissions query; retry command; outbound events; test-event action; then the UI.

### Proposed seams (existing seams preferred; please confirm)

1. **The importer's existing `importReceipt` seam** for all three webhook events. Tests run it against real Postgres with the existing in-memory storage and queue adapters, plus the in-memory notifier, and assert which events were emitted, in what quantity, and with what data. This covers once-only emission, no event on transient retry, `rfq.failed` on exhaustion, and no event on a repeat trigger. No new seam is needed.
2. **The receipt discovery seam (`scanForReceipts`)** for the new-import count, extended in place. Tests cover: new submission counted; completed not counted; cleanup-only not counted; future retry not counted; due retry counted; expired lease counted; permanently failed not counted. Real Postgres ledger, in-memory storage and queue.
3. **One new seam: the sync command.** It is the right place to test the cooldown (single scan under concurrent calls, shared result, disabled-intake refusal, failed scan still starting the cooldown), because the cooldown and the scan result are one behaviour.
4. **One new seam: the submissions query plus Retry now.** Together they form the admin list's data interface. Tests cover status grouping, ordering, paging, receipt-number-or-session-ID fallback, Quote linkage, and Retry now's Admin/Dev authorisation and schedule reset.
5. **The settings and test-event functions** are tested at the function level: URL validation (accept `http`, accept `https`, reject other schemes), masking, and the test action returning status or error against a local test receiver. These are small and need no new infrastructure.

- Route and UI behaviour (banner states, hidden button when disabled, polling that starts and stops) is covered by a few focused React Testing Library tests in the repository's existing style. They avoid Tailwind class assertions and internal component state. The repo has little route testing today (see ADR-0010), so keep these narrow and rely on the lib-level seams for logic.

### Prior art

- Real-Postgres integration tests with in-memory storage and queue adapters for the importer and Action Items.
- The existing discovery tests for scan behaviour.
- The Action Items integration tests for Admin/Dev command authorisation.
- Focused React Testing Library tests for banners and badges elsewhere in the app.

## Out of Scope

- Webhook retries, a delivery queue, persisted delivery history, a delivery log page, or any delivery status beyond the Send test result.
- Webhook signing, shared secrets, custom headers, per-event toggles, or multiple URLs.
- Search, date-range filters, or sorting options on the submissions list beyond status tabs and paging.
- Listing the intake bucket in the admin page, or showing unreceipted/abandoned prefixes.
- Surfacing receipt numbers to non-Admin/Dev users or on Quote pages.
- Changes to the Action Items policy for when failures appear and the retry details shown there (tracked separately in issue 166).
- Removing the failed-job queue workarounds and recovery scripts (issue 168), the real-Postgres coverage backlog (issue 167), and the small hardening items (issue 170).
- A Sync control anywhere other than the Quotes page.
- Cleanup of abandoned intake prefixes.
- Any database migration.

## Further Notes

- This ships in the same pull request as the webhook-response fix and dedicated intake bucket, so the feature lands as one unit. The pull request description should be updated to cover the added scope.
- Deployment: the web container now needs the `INTAKE_S3_*` settings in every environment where sync is enabled. Document this and update the env-to-files conversion script and deployment README. ADR-0011 should be amended to record that the web process reads from the intake bucket for the sync action only; it still never writes to it, and deletion remains the Worker's job.
- The admin sync scan lists the whole intake prefix each time. The shared 30-second cooldown bounds the cost; the known scan-cost-grows-with-abandoned-prefixes limit from the ADR still applies.
- Vocabulary: "RFQ" is a Quote status, not an entity. The UI uses "RFQs" informally for the button and banner as requested, while code and docs refer to intake submissions, the import ledger, and Quotes.
- Fire-and-forget means a restart of the Worker between commit and POST can drop an event. This is an accepted trade-off for the initial version; `eventId` and the ledger make a later move to queued delivery straightforward.
