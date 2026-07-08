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

`npm run dev` starts Remix and the worker concurrently. Async email, CAD conversion, and Toolpath require the worker.

## Directory roles

```
app/
├── routes/           # Remix pages and resource routes (~41 files)
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
| **Toolpath** | `_protected.toolpath.*` | `toolpath.ts`, `toolpath.server.ts`, `toolpath-upload.server.ts` |
| **Email (user)** | `_protected.email._index` | `sent-emails.server.ts` |
| **Email (admin)** | `_protected.admin.email` | `app/lib/email/*` |
| **Admin** | `_protected.admin.*` | `users.admin.server.ts`, `audit-log.ts`, data retention |
| **Settings / flags** | `_protected.settings` | `featureFlags.ts`, developer settings in schema |
| **Downloads** | `_protected.download.$.ts` | `file-download.server.ts`, `downloadQuoteFiles.ts`, `s3.server.ts` |
| **Events** | `_protected.events._index` | `events.ts` |
| **Auth** | `login`, `auth.callback`, `logout`, `setup-password` | `auth.server.ts`, `supabase.ts` |
| **Stubs** | `_protected.ActionItems` | Coming soon — linked from nav |

## God routes (high churn — refactor targets)

| Route | Lines | Action intents | Notes |
|-------|-------|----------------|-------|
| `_protected.quotes.$quoteId.tsx` | ~4,924 | 35 | Line items, attachments, notes, email, PDF, Toolpath, Stripe |
| `_protected.orders.$orderId.tsx` | ~4,337 | 48 | Same cross-cutting patterns + tracking, vendor pay, PO/invoice PDFs |
| `_protected.settings.tsx` | ~1,600+ | many | Feature flags, dev settings, placeholder tabs |

Business logic for these should eventually live in deep `app/lib` modules; routes become thin adapters.

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
| `toolpath-upload` | `handlers/toolpath-upload.ts` | Upload quote part to Toolpath |
| `toolpath-report-poll` | `handlers/toolpath-report-poll.ts` | Poll machinability report |
| `toolpath-stale-cleanup` | `handlers/toolpath-stale-cleanup.ts` | Clean stale Toolpath jobs |
| `purge-archived-line-items` | `handlers/purge-archived-line-items.ts` | Hard-delete archived line items |
| `mock-job` | inline in worker.ts | **Stale** — remove when cleaning infra |

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
