# Architecture Map

Where things live in the Subtract Cloud Frontend codebase. For domain vocabulary, see [CONTEXT.md](../CONTEXT.md). For recorded decisions, see [docs/adr/README.md](adr/README.md).

## Stack

| Layer | Technology |
|-------|------------|
| Web framework | Remix (Vite) |
| UI | React, TypeScript |
| Database | PostgreSQL via Drizzle ORM |
| Auth | Supabase |
| File storage | S3 (Supabase storage) |
| Async jobs | pg-boss (`scripts/worker.ts`) |
| Email | Postmark |
| Payments | Stripe payment links |

## Request flow

```
Browser → Remix route (loader/action) → app/lib module → db / S3 / queue producer
                                              ↓
                                    pg-boss worker (separate process)
                                              ↓
                                    queue handler → external service
```

`npm run dev` starts Remix and the worker concurrently. Async email and CAD conversion require the worker.

## Directory roles

```
app/
├── routes/           # Remix pages and resource routes (~41 files); detail routes are thin, see below
├── components/       # React UI by domain (orders/, quotes/, email/, admin/, shared/)
├── lib/              # Server logic and data access (~150 modules)
│   ├── db/           # schema.ts, client, migrations metadata
│   ├── email/        # Outbound email (best-structured subdomain)
│   ├── queue/        # pg-boss producers, handlers, types
│   └── stripe/       # Checkout address import
├── emails/           # React Email layouts
├── hooks/            # useDownload, useMeshConversion
└── test/             # Integration test seed helpers

scripts/
└── worker.ts         # pg-boss consumer process

docs/
├── architecture-map.md   # This file
├── adr/                  # Architecture decision records (backlog + accepted)
├── email-template-merge-tokens.md
└── pdf/presets.md
```

## Routes by domain

| Domain | Routes | Lib modules |
|--------|--------|-------------|
| **CRM** | `_protected.customers.*`, `_protected.vendors.*` | `customers.ts`, `vendors.ts`, `bulk-import.ts`, `bulk-export.ts` |
| **Quoting** | `_protected.quotes.*`, `_protected.quotes.new` | `quotes.ts`, `quoteParts.ts`, `quotePriceCalculations.ts` |
| **Orders** | `_protected.orders.*` | `orders.ts`, `lineItems.ts`, `order-tracking.ts`, `order-delivery.ts` |
| **Parts / CAD** | `_protected.parts.*`, `_protected.quote-parts.*`, `_protected.mesh-conversion.*` | `parts.ts`, `cadVersions.ts`, `*-mesh-converter.server.ts`, `conversion-service.server.ts`, `part-asset-admin.server.ts` |
| **Email (user)** | `_protected.email._index` | `sent-emails.server.ts` |
| **Email (admin)** | `_protected.admin.email` | `app/lib/email/*` |
| **Admin** | `_protected.admin.*` | `users.admin.server.ts`, `audit-log.ts`, data retention |
| **Settings / flags** | `_protected.settings` | `featureFlags.ts`, developer settings in schema |
| **Downloads** | `_protected.download.$.ts` | `file-download.server.ts`, `downloadQuoteFiles.ts`, `s3.server.ts` |
| **Events** | `_protected.events._index` | `events.ts` |
| **Auth** | `login`, `auth.callback`, `logout`, `setup-password` | `auth.server.ts`, `supabase.ts` |
| **Stubs** | `_protected.ActionItems` | Coming soon — linked from nav |

## Detail routes: intent tables behind a seam

`_protected.quotes.$quoteId.tsx` and `_protected.orders.$orderId.tsx` used to hold their whole
loader, action and page (about 4,400 lines each). They are now about 30 lines: the route
authenticates, hands off, and renders. Behaviour lives in deep modules that can be tested without
Postgres, S3 or Stripe.

```
route loader/action  ->  app/lib/{quote,order}-detail/{loader,action}.server.ts   (Request, auth, cookies)
                              |
                              v
                         runQuoteIntent / runOrderIntent   (action.ts: authenticated input, Response out)
                              |  dispatchIntent(table, intent)
                              v
                         intents/*.ts   one module per concern; each handler decides, never does I/O itself
                              |  ctx.deps (ports)
                              v
              ports.ts  <-- production adapter: deps.server.ts (Postgres, S3, Stripe, queue)
                        <-- test adapter:       test-support.ts (vi.fn fakes)

route loader  ->  loadQuoteDetail / loadOrderDetail(input, deps)   (loader.ts: what to fetch, how to shape it)
                              |  deps (QuoteLoaderDeps / OrderLoaderDeps)
                              v
                  production adapter: loader.server.ts (createQuoteLoaderDeps / createOrderLoaderDeps)
                  test adapter:       loader.test.ts (vi.fn fakes)

route default export  ->  components/quotes/QuoteDetailPage.tsx, components/orders/OrderDetailPage.tsx
```

| Path | Role |
|------|------|
| `app/lib/route-actions/core.ts` | `IntentTable`, `dispatchIntent`, `actorFromAuth`, response helpers |
| `app/lib/route-actions/` (shared) | `uploadDrawings`, `generateEntityDocument`, `noteIntents`, `loadSendComposer`, `signDrawingAttachments`, part-attribute change events. Used by both routes. |
| `app/lib/quote-detail/` | Quote ports, intents (`lifecycle`, `line-items`, `parts`, `attachments`, `receive-po`, `documents-email`), `acceptance.ts` (policy), `line-item-form.ts` (pure parsing), `loader.ts` + `part-view.ts` (page data), `view.ts` (UI rules), `line-item-edit.ts` (inline-edit plan) |
| `app/hooks/usePolling.ts` | Capped interval polling; both pages use it to refresh while parts convert |
| `app/lib/order-detail/` | Order ports, intents (`lifecycle`, `line-items`, `parts`, `attachments`, `tracking`, `job-board`, `documents-email`), `tracking-form.ts`, `loader.ts` (page data), `view.ts`, `line-item-edit.ts` (inline-edit plan) |

**Adding or changing an action:** add a handler to the matching `intents/*.ts` table, reach the
outside world only through `ctx.deps`, and test it with `makeQuoteCtx()` / `makeOrderCtx()` from
`test-support.ts`. If a handler needs a new kind of I/O, add a method to `ports.ts` and implement it
in `deps.server.ts`. `action.test.ts` in each folder pins the full list of intents, so renaming or
dropping one fails a test instead of silently breaking a button.

**Adding page data:** add the lookup to `QuoteLoaderDeps` / `OrderLoaderDeps` in `loader.ts`, wire
the real function in `loader.server.ts`, and cover any condition around it in `loader.test.ts`.

**Page logic:** the page components still hold their own UI state and JSX (about 2,200 lines
each). Rules worth testing are pulled out as pure functions (`view.ts`, `line-item-edit.ts`) or
hooks (`usePolling`); splitting the JSX into section components is the remaining step. Loader data
is untyped in the pages because `withAuthHeaders` returns a plain `Response`.

**Conventions:** handlers return a `Response` and never call `withAuthHeaders` (the route applies
auth headers once). Pure rules (parsing, pricing, status policy, presentation) live in plain
modules with no imports from `*.server.ts`.

`_protected.settings.tsx` (~1,600+ lines) is still a god route and has not been reworked.

## Line-item modules (known duplication)

| Module | Callers | Scope |
|--------|---------|-------|
| `app/lib/lineItems.ts` | Orders route, shared line-item types | Order line items + events + totals |
| `app/lib/line-items.ts` | Email order resolver | Order + quote line item reads (simpler) |
| `app/lib/quotes.ts` | Quotes route | Quote line item CRUD + totals |

**Planned:** consolidate into one LineItem module (see ADR backlog).

## Queue topology

Defined in `app/lib/queue/types.ts`, consumed by `scripts/worker.ts`:

| Queue | Handler | Purpose |
|-------|---------|---------|
| `send-email` | `handlers/send-email.ts` | Postmark outbound delivery |
| `cad-conversion` | `handlers/cad-conversion.ts` | CAD → mesh conversion |
| `purge-archived-line-items` | `handlers/purge-archived-line-items.ts` | Hard-delete archived line items |
| `mock-job` | inline in worker.ts | **Stale** — remove when cleaning infra |
| `rfq-import` | `handlers/rfq-intake.ts` | Import one receipted WordPress RFQ (one active job per Worker) |
| `rfq-receipt-scan` | `handlers/rfq-intake.ts` | Discover receipted intake prefixes (cron: 1 min non-prod, 5 min prod; `RFQ_RECEIPT_SCAN_CRON`) |

RFQ intake is implemented as the deep module under `app/lib/rfq-intake/`; see [ADR-0011](adr/0011-wordpress-rfq-intake.md).

**Required env:** `DATABASE_URL` (Remix), `DATABASE_DIRECT_URL` (pg-boss worker — non-pooler connection).

## Download architecture

Unified resource route: `/download/*`

| Pattern | Handler |
|---------|---------|
| `/download/attachment/{id}` | Attachment by ID |
| `/download/part/{id}` | Part CAD/STEP |
| `/download/quote-part/{id}` | Quote part CAD |
| `/download/quote/{id}` | Quote bundle ZIP |
| `/download/s3/{key}` | Direct S3 key |
| `/download/mesh/{partId}` | Mesh URL (JSON) |

Client: always use `useDownload()` from `app/hooks/useDownload.ts`.

**Known scope creep:** bulk customer/vendor CSV/JSON export also lives on this route — candidate for split (ADR backlog).

## Email subsystem (positive reference)

Best-structured area — copy this pattern for other domains:

```
email-context-registry.ts   → template contexts
resolve/                    → merge token population per entity
handlers/                   → send flows (quote, order confirmation)
enqueue-outbound-email      → queue producer
docs/email-template-merge-tokens.md
```

36 of 36 test files target email, queue handlers, or closely related utilities.

## Test coverage summary

| Guarded | Unguarded |
|---------|-----------|
| `app/lib/email/**` | All route files |
| Queue handler unit tests | `orders.ts`, `attachments.ts`, `parts.ts` |
| `business-days`, `order-tracking`, stripe addresses | PDF stack, S3, `featureFlags.ts` |
| `line-item-archive`, narrow integration tests | CAD/mesh end-to-end |

Strategy: test deep lib modules before extracting god routes (ADR backlog).

## Configuration surfaces

| Surface | Path | Contains |
|---------|------|----------|
| Admin Console | `/admin` | Users, email admin, Stripe admin, data retention |
| Settings | `/settings` | Feature flags, developer settings, Stripe defaults, dev tools |
| In-app | — | Role checks in `_protected+/_layout.tsx` |

Feature flags default off for many shipped-adjacent features — see flag audit in ADR backlog.

## CI / automation

| Workflow | Path | Purpose |
|----------|------|---------|
| PR Checks | `.github/workflows/pr-checks.yml` | Lint, typecheck, migrations, tests, Trivy |
| PR Agent | `.github/workflows/pr-agent.yml` | OpenAI-powered PR review ([docs](pr-code-review.md)) |
| Staging / production deploy | `.github/workflows/staging-deploy.yml`, `production-deploy.yml` | Docker → GHCR |
| Release Please | `.github/workflows/release-please.yml` | Version bumps and changelogs |

## Related docs

- [CLAUDE.md](../CLAUDE.md) — dev commands, DB rules, download patterns
- [docs/pr-code-review.md](pr-code-review.md) — PR-Agent setup, model, pricing, tuning
- [docs/email-template-merge-tokens.md](email-template-merge-tokens.md)
- [docs/pdf/presets.md](pdf/presets.md)
- [CONTEXT.md](../CONTEXT.md) — domain glossary
