# Architecture Decision Records

ADRs capture significant architectural decisions so future reviews don't re-litigate settled choices. Full ADRs are written when a decision is made during implementation or grilling sessions.

## Status legend

| Status | Meaning |
|--------|---------|
| **Backlog** | Decision needed — friction identified, not yet decided |
| **Proposed** | Draft ADR under discussion |
| **Accepted** | Decision recorded and in effect |
| **Superseded** | Replaced by a later ADR |

## Backlog (decisions to record)

These topics emerged from the [architecture review](../architecture-map.md). Write a full ADR when you pick one to implement.

| ID | Topic | Why record | Related friction |
|----|-------|------------|------------------|
| ADR-0001 | **Line-item module consolidation** | Three modules (`lineItems.ts`, `line-items.ts`, quote fns in `quotes.ts`) with overlapping interfaces | Email resolver uses different import than orders route; bug fixes need triple application |
| ADR-0002 | **God route extraction strategy** | Quote and order detail routes are 4–5k lines with 35–48 action intents | Need agreed pattern: resource routes vs. lib action modules vs. Remix `action` delegates |
| ADR-0003 | **Quote-to-order conversion boundary** | `convertQuoteToOrder` is ~597 lines inside `quotes.ts` | Highest-risk transaction; needs explicit rollback and test surface |
| ADR-0004 | **Notes migration completion** | Normalized `notes.ts` active; `order-notes.ts` orphaned; `orders.notes` column remains | Schema clutter; deletion test passes on legacy module |
| ADR-0005 | **pg-boss worker topology** | Worker required but undocumented in README | Queue names, env vars (`DATABASE_DIRECT_URL`), failure modes, dev startup |
| ADR-0006 | **Feature-flag policy** | 19 flags, 15 default off — unclear launch gate vs. permanent toggle | Hidden product backlog; production surprises |
| ADR-0007 | **Download route scope** | Bulk CSV/JSON export shares `/download/*` with file downloads | CLAUDE.md describes downloads only; seam scope creep |
| ADR-0008 | **Admin vs Settings configuration map** | Feature flags in Settings; Admin search describes them at `/admin` | Operator confusion; duplicate Stripe config |
| ADR-0009 | **CAD/mesh pipeline interface** | Five+ modules + queue handler for one conceptual pipeline | End-to-end behavior hard to trace and test |
| ADR-0010 | **Route testing strategy** | Zero route tests; 36 tests mostly in email | Refactor safety before god route extraction |

## Accepted (from existing docs and conventions)

These are implicit decisions already reflected in code or CLAUDE.md. Consider promoting to full ADRs if questions recur.

| Decision | Source | Summary |
|----------|--------|---------|
| Soft deletes via `isArchived` | CLAUDE.md, schema | All entities archive; no hard delete in UI |
| Manual migration generation | CLAUDE.md | Never auto-run `db:generate`; one migration per feature |
| Dev schema sync via `db:push` | CLAUDE.md, README | `npm run dev` pushes schema to local DB |
| Unified download resource route | CLAUDE.md | `/download/*` + `useDownload()` hook |
| Order number format | CLAUDE.md, CONTEXT.md | `YY[LETTER][5-DIGIT]` |
| Email merge token catalog sync | docs/email-template-merge-tokens.md | Must match `app/lib/email/resolve/types.ts` |

## Writing a new ADR

When a backlog item is picked for implementation:

1. Copy the template below to `docs/adr/NNNN-short-title.md`
2. Update this README — move entry from Backlog to Accepted
3. Link from [architecture-map.md](../architecture-map.md) if it affects "where things live"

### Template

```markdown
# ADR-NNNN: Title

## Status
Accepted | Proposed | Superseded by ADR-XXXX

## Context
What friction or constraint forced a decision?

## Decision
What we chose.

## Consequences
Positive, negative, and follow-up work.
```

## Related

- [CONTEXT.md](../../CONTEXT.md) — domain vocabulary
- [architecture-map.md](../architecture-map.md) — module locations
