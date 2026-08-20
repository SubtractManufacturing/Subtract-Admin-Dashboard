# Research: structured analytics for quotes and orders

**Status:** research, not an implementation decision.
**Audience:** operators and engineers who want time-based planning metrics (quote counts, conversion, average values, parts mix) without assuming a data-warehouse background.
**Date:** 2026-08-20.

This note answers: should analytics live in this app; is there a plug-in framework; is the current schema ready; do we need a time-series or separate database; and what the canonical query / report / chart stack looks like.

---

## Short answers

| Question | Answer |
|----------|--------|
| Implement it in this application? | **Yes, as a metrics module**, not as SQL sprinkled into routes. The home dashboard already does a thin version of this. |
| Framework that plugs in with no modeling? | **No.** Chart libraries plug in easily. BI tools (Metabase) and semantic layers (Cube, Lightdash) plug into Postgres, but someone still has to define metrics. |
| Are we structured for this? | **Mostly, for current-state facts.** Quotes and orders already have timestamps, statuses, totals, conversion links, and line items. We are **not** structured for “what was true on a past day” or unconstrained “compare anything.” |
| Separate analytics database? | **Not yet.** Stay on the same Postgres. Isolate analytics *queries* (timeouts, later a read replica), not the data. |
| Time-series database? | **No.** These are relational business facts with a time *dimension*, not high-ingest sensor streams. |
| Canonical approach at our scale | **Metrics catalog → SQL on Postgres → charts in Remix.** Optionally Metabase as a sidecar for ad-hoc exploration. Warehouse / Cube / ClickHouse only if volume or sources explode. |

---

## 1. Three different products called “analytics”

Mixing these up is the usual way teams buy the wrong tool.

| Kind | Question it answers | Typical tools | Fit here |
|------|---------------------|---------------|----------|
| **Business / operational analytics** | How many quotes this week? Average order value? Win rate by vendor? | SQL + charts, Metabase, Cube, Lightdash, dbt Semantic Layer | **This is what you described.** |
| **Product analytics** | Which screens do users click? Where do they drop off? | PostHog, Mixpanel, Amplitude | Useful later for *admin UX*, not for quote dollar values. PostHog’s own docs say product analytics runs on events you send about *what people do in the product*. |
| **Time-series / observability** | Sensor readings, CPU, request latency, millions of points/sec | InfluxDB, Prometheus, Timescale hypertables | Wrong grain. InfluxDB’s examples are industrial sensors, server metrics, heartbeats, rainfall, stock ticks. |

Your examples — quote count, average quote value, quotes converted to orders, parts per quote vs per order — are **business facts** sitting in Postgres today. They are not clickstream, and they are not IoT.

---

## 2. Canonical architecture (the industry pattern)

Every serious analytics stack, from a 200-line admin dashboard to Snowflake, uses the same four layers. Tools just fill different layers.

```
┌─────────────────────────────────────────────────────────────┐
│  4. Presentation   charts, dashboards, CSV, scheduled email │
│     Remix + Recharts / Metabase / Evidence / Cube UI        │
├─────────────────────────────────────────────────────────────┤
│  3. Query           “metric × dimensions × time grain”      │
│     SQL / Drizzle / Cube REST / Metabase questions          │
├─────────────────────────────────────────────────────────────┤
│  2. Semantic layer  named metrics with one definition each  │
│     TypeScript catalog / Cube cubes / dbt MetricFlow YAML   │
├─────────────────────────────────────────────────────────────┤
│  1. Facts           rows that actually happened             │
│     quotes, orders, line items  (optionally snapshots)      │
└─────────────────────────────────────────────────────────────┘
```

### Layer 1 — facts and grain

Kimball dimensional modeling is still the canonical way to think about this, even if you never build a warehouse. The pivotal step is **declaring the grain**: exactly what one row represents. Atomic grain is the lowest level the business process captures. Different grains must not share a table, or you will double-count.

For Subtract, three grains already exist in the OLTP schema:

| Grain (one row means…) | Table | Additive facts |
|------------------------|-------|----------------|
| One quote | `quotes` | count, `total`, converted-or-not |
| One order | `orders` | count, `total_price`, `vendor_pay` |
| One priced line | `quote_line_items` / `order_line_items` | quantity, unit price, line total |
| One part spec on a quote | `quote_parts` | count of distinct parts (not dollars) |

“Average parts per quote” is **quote grain** (count of child rows, then average). “Average dollar amount of a part” is **line-item grain**. Those must not be averaged together as if they were the same thing.

Kimball also names three fact *types*:

- **Transaction grain** — a quote was created, a quote was sent, an order shipped. One row per event.
- **Periodic snapshot** — “how many quotes were sitting in `Sent` at the end of each day.” Requires a daily snapshot; current status on `quotes` cannot answer this after the fact.
- **Accumulating snapshot** — one row per quote with `created_at`, `sent_at`, `accepted_at`, `converted_at`. We already have most of these columns on `quotes`.

### Layer 2 — semantic layer (the part people skip)

A metric is a named aggregation with a documented time stamp, filters, and grain. “Average quote value” is not a chart setting; it is a definition:

> Mean of `quotes.total` for non-archived quotes, bucketed by `date_trunc` of `quotes.created_at` (or `sent_at` — pick one and never mix).

Cube, Lightdash, and dbt MetricFlow exist so that definition is written **once** and every chart, API, and AI agent uses it. Cube’s docs: the semantic layer centralizes metric definitions, joins, access rules, and caching upstream of every consumer. Lightdash: define metrics and dimensions once in YAML; the tool generates SQL. dbt MetricFlow: metrics are functions; without dimensions a metric is “simply a number for all time.”

You do not need those products on day one. You do need the *idea*: a catalog in code, not copy-pasted SQL in three loaders.

### Layer 3 — query

Postgres is the query engine. Official primitives that cover this workload:

- [`date_trunc`](https://www.postgresql.org/docs/current/functions-datetime.html) — bucket timestamps to day / week / month.
- `GROUP BY` + `COUNT` / `SUM` / `AVG` / `FILTER`
- Window functions for running totals and period-over-period
- [`MATERIALIZED VIEW`](https://www.postgresql.org/docs/current/rules-materializedviews.html) — Postgres’s own example is a sales graph refreshed nightly

Cube’s REST query format is the same idea as JSON: `{ measures, dimensions, timeDimensions: { granularity, dateRange }, filters }`. A small in-app module can speak that shape without running Cube.

### Layer 4 — visualization

Charts are dumb. They consume arrays of `{ period, metricA, metricB }`. Line = trend over time, bar = compare categories or periods, pie = share of a whole (use sparingly; only for a parts-of-one-total question).

Reporting is the same data with a different sink: on-screen dashboard, CSV download, later a scheduled email via the existing pg-boss / Postmark path.

---

## 3. Fit against this codebase

### What already works in our favor

The operational model is already a quoting and order system, not a click log.

- **Quotes** (`app/lib/db/schema.ts`) carry `createdAt`, `sentAt`, `acceptedAt`, `expiredAt`, `status`, `subtotal`, `total`, `convertedToOrderId`, `customerId`, `vendorId`.
- **Orders** carry `createdAt`, `status`, `totalPrice`, `vendorPay`, `quoteId` / `sourceQuoteId`, `customerId`, `vendorId`.
- **Conversion** is a first-class link: `convertQuoteToOrder` writes `convertedToOrderId` in the same transaction that creates the order (`app/lib/quotes.ts`).
- **Line items and parts** exist on both sides of conversion (`quote_line_items` + `quote_parts` vs `order_line_items` + `parts`).
- **Home dashboard** (`app/lib/dashboard.ts`, `StatCards`) already aggregates open-PO revenue, open PO count, and recent quote count — the seed of layer 2, currently inlined.
- **Supabase + Postgres + Drizzle** is exactly what Metabase’s first-party Supabase guide and Cube’s Postgres driver expect as a source.
- **pg-boss** can refresh materialized views on a schedule later, the same way Postgres’s docs suggest a nightly `REFRESH MATERIALIZED VIEW`.

### What is *not* an analytics store

`event_logs` is an **audit timeline** for the UI (`EventTimeline`, `/events`). Rows are polymorphic (`entity_type` + `entity_id`), titled for humans, optionally dismissed, with JSON `metadata`. That is the wrong grain for additive metrics:

- Dismissing an event would change history if you counted it.
- Status changes are unstructured strings in `metadata`.
- There is no guarantee every financial field change is logged.
- JSONB `->>'orderId'` filters will not stay cheap.

Use `event_logs` to *explain* a spike (“who moved this quote?”), not to *compute* quote volume.

### Structural gaps (do these before “compare anything”)

1. **Time column is a product decision, not a database one.** “Quotes over time” must pick `created_at` vs `sent_at`. Conversion rate denominator should probably be *sent* quotes, not *created* drafts. Document this in the catalog.
2. **Current status ≠ history.** `quotes.status = 'Sent'` tells you who is Sent *now*. It cannot tell you how many were Sent on 1 March. For that you need either accumulating timestamps (we have some) or a periodic snapshot job.
3. **Orders have almost no lifecycle timestamps.** Status moves `Pending → … → Completed` with only `createdAt` / `updatedAt`. Planning questions like “average days in production” need `shipped_at` / `completed_at` or a status-history table.
4. **Denormalized money can drift.** `quotes.total` and `orders.total_price` are stored columns, not computed from lines at query time. Pick a source of truth (stored total vs `SUM(line)`) and test it.
5. **Soft delete / archive is inconsistent.** Quotes use `isArchived`; orders use status `Archived`. Line items have `isArchived` + purge jobs. Every metric needs an explicit “include archived?” rule.
6. **`quote_id` vs `source_quote_id` on orders.** Conversion analytics must say which column is canonical (today conversion writes `convertedToOrderId` on the quote; orders also store a quote link).
7. **No time indexes on `quotes` or `orders`.** `event_logs` and `customer_communications` have `created_at` indexes; quote/order tables do not. Range reports will sequential-scan until indexed.
8. **Order line items have no `createdAt`.** Quote lines do. Part-value-over-time on orders has to use the parent order’s timestamp.
9. **Timezone.** `date_trunc('week', created_at)` is session-timezone dependent. Pick UTC or a shop-local zone and pass it into `date_trunc(..., timezone)` ([Postgres docs](https://www.postgresql.org/docs/current/functions-datetime.html)).
10. **God routes.** Quote/order detail files are 4–5k lines. Analytics SQL must not land there. Architecture map already calls this out; a deep `app/lib/analytics` module is the seam.

We are structured enough to ship a useful planning dashboard from **existing tables**. We are not structured for a generic pivot cube over every column without a metrics catalog and a few indexes.

---

## 4. Same database, warehouse, or time-series DB?

### Stay on Postgres (recommended now)

ClickHouse’s own intro: OLTP reads/writes a few rows in milliseconds; OLAP scans billions. We have quoting and fulfillment volume, not billions of hits. Postgres with `date_trunc` + indexes will answer “quotes per week for two years” on a table of tens or hundreds of thousands of rows without drama.

Postgres materialized views exist specifically so a dashboard can graph historical sales without recomputing every page load, accepting that data is only as fresh as the last `REFRESH`.

When analytics queries start competing with quote saves: add `statement_timeout` on the analytics connection, then a **Supabase read replica** ([read replicas](https://supabase.com/docs/guides/platform/read-replicas)) so aggregations do not block writes. That is still the same logical database.

### Not a time-series database

Timescale hypertables automatically partition **append-mostly time-series and event** data by time. InfluxDB is “purpose-built to collect, store, process and visualize time series data” — sensors, server metrics, successive measurements from the same source.

Quotes are **mutable business entities**: status updates, price edits, archive flags. That is OLTP. Forcing them into a TSDB loses joins to customers/vendors/line items, which is the whole point of “compare quote value vs order value by vendor.”

A *daily snapshot* of pipeline counts is time-series-shaped. Store that snapshot **in Postgres** (one row per day per status). You would consider Timescale only if those snapshots reached tens of millions of rows and query time hurt — far beyond this app.

### Not ClickHouse / Snowflake yet

ClickHouse is a column-oriented OLAP engine for aggregations over massive datasets. The usual pattern is Postgres for transactions, CDC into ClickHouse for analytics. That split pays off at high ingest and high concurrency of heavy scans. It is an ops and modeling tax we should not take for an internal admin.

A warehouse + dbt Semantic Layer (MetricFlow) is the canonical *data-team* stack: YAML metrics, joins generated for you, BI tools downstream. dbt documents MetricFlow against Snowflake/BigQuery/Databricks/Redshift (Postgres only on dbt Core). We have no warehouse, no dbt project, and one Postgres. Adopting this now is buying a second platform to answer questions the first platform already holds.

### When a separate store *would* make sense

- Mixing Stripe, Postmark, Toolpath, and shop-floor data that does not live in this DB
- Analysts running unconstrained SQL during business hours against production
- Row counts where a weekly dashboard scan is slower than a page-load budget
- Regulatory need to freeze historical numbers when operational rows are edited

Until then: **same database, separate query path, named metrics.**

---

## 5. Framework landscape (what actually plugs in)

Nothing “understands Subtract quotes” out of the box. Everything below still needs metric definitions. Ranked for *this* stack (Remix, Drizzle, Supabase Postgres, internal admin).

### A. In-app: metrics module + chart library (best first step)

| Piece | Role | Notes |
|-------|------|--------|
| TypeScript metrics catalog in `app/lib/analytics` | Semantic layer | One function: `queryMetrics({ metrics, grain, range, dimensions, filters })`. Deep module; routes stay thin. |
| Drizzle / SQL against `quotes`, `orders`, line items | Query | Use `date_trunc`, explicit archive filters, indexes on time columns. |
| Recharts, Chart.js, Apache ECharts, or shadcn charts (Recharts-based) | Presentation | Cube’s React client is explicitly visualization-agnostic and documents Chart.js / similar. No chart library is in `package.json` today. |
| Existing Remix auth + feature flags | Access | Internal-only; no multi-tenant embedding problem. |

**Pros:** matches how email, queue, and dashboard already work; testable; no new runtime. **Cons:** “compare anything” is only as flexible as the catalog you ship.

### B. Sidecar BI on the same Postgres (best for ad-hoc)

**Metabase** is the path Supabase documents first-party: Docker, connect session pooler, explore. Embedding: modular components or full-app iframe; guest JWT embeds work on OSS for view-only charts; SSO / query-builder embeds need Pro.

This is the closest thing to “plug in and click.” Operators can build bar/line/pie without a deploy. Risk: five people define “average quote value” five ways unless they query **views you wrote** (the semantic layer as SQL).

**Apache Superset** is the heavier open-source BI (SQL Lab, many viz types). Connects to Postgres as a database. More ops, more power, worse fit for a small internal team than Metabase.

**Evidence.dev** renders a site from markdown + SQL against Postgres (official connector). Excellent if planning reports should live in git next to the app. Not a click-to-explore UI.

### C. Semantic-layer services (best if many consumers appear)

**Cube** (open-source Core + Cube Cloud): code-first cubes/views, REST/GraphQL/SQL APIs, React embed SDK, pre-aggregations. Official Postgres source (`CUBEJS_DB_TYPE=postgres`). Query JSON is `{ measures, dimensions, timeDimensions }`. Extra Node (or Cloud) service to run, plus a data model to write. Worth it if in-app charts *and* Metabase *and* AI agents must share definitions.

**Lightdash**: YAML metrics/dimensions, generates SQL, Metrics Catalog UI, API. Works with dbt or standalone YAML, including Postgres. Another app to host.

**dbt Semantic Layer / MetricFlow**: warehouse-native. Premature here.

### D. Wrong category (do not use as source of truth)

| Tool | Why it looks tempting | Why not |
|------|----------------------|---------|
| PostHog / Mixpanel | Funnels, trends, dashboards | Product events, not quote totals. PostHog: “what people actually do in your product.” Their BI notes even point advanced BI elsewhere. |
| Prometheus | “Metrics” | Ops scrape metrics, not dollar facts. |
| InfluxDB | Time-based graphs | Measurement streams, not joined business entities. |

### Comparison (this repo)

| Option | Talks to our Postgres? | Embed in Remix? | Defines metrics? | New infra? | Recommend |
|--------|------------------------|-----------------|------------------|------------|-----------|
| In-app catalog + Recharts | Yes | Native | You write TS | No | **Phase 1** |
| SQL views + Metabase sidecar | Yes (Supabase docs) | Optional iframe/SDK | You write views | One container | **Phase 1b for ad-hoc** |
| Evidence reports | Yes | Separate site | SQL in markdown | Separate app | If reports should be git-native |
| Cube Core | Yes | REST + React | YAML/JS cubes | Cube process | Phase 2 if many UIs |
| Lightdash | Yes | API | YAML | Lightdash process | Alternative to Cube |
| dbt + warehouse | After ETL | Via BI | YAML | Warehouse + dbt | Phase 3 |
| ClickHouse / Tinybird | After CDC | Custom | You model | Yes | Not at this volume |
| Timescale | Same PG if extension allowed | n/a | n/a | Extension | Not needed |
| PostHog | No (new event stream) | Widget | Event properties | Yes | Product UX only |

There is no framework that “plugs right in easily” *and* knows quote conversion. The easy plugs are **charts** (library) and **explore** (Metabase on Postgres). The hard, valuable part is **metric definitions**.

---

## 6. How reporting, visualization, and querying should work

### Query shape (do this even without Cube)

Every chart is one query:

```text
metrics:     [quote_count, quote_avg_value, quotes_converted]
grain:       week | month | day
range:       2025-01-01 → 2025-12-31
dimensions:  [] | [customer] | [vendor] | [status]
filters:     { archived: false }
compare:     previous_period | previous_year | second_metric
```

Postgres equivalent:

```sql
SELECT
  date_trunc('week', created_at AT TIME ZONE 'UTC') AS period,
  COUNT(*) FILTER (WHERE NOT is_archived) AS quote_count,
  AVG(total::numeric) FILTER (WHERE NOT is_archived) AS quote_avg_value,
  COUNT(*) FILTER (
    WHERE converted_to_order_id IS NOT NULL AND NOT is_archived
  ) AS quotes_converted
FROM quotes
WHERE created_at >= $1 AND created_at < $2
GROUP BY 1
ORDER BY 1;
```

Fill empty weeks with `generate_series` so line charts do not skip quiet periods.

“Compare A against B” is two series on one time axis, or a ratio metric (`quotes_converted / quotes_sent`). Unconstrained “any column vs any column” is a BI tool; a good in-app UI offers **allowed pairs** from the catalog.

### Visualization

| Chart | Use |
|-------|-----|
| Line | Trends (quotes/week, AOV over months) |
| Bar | Categories (by vendor, by status) or period comparison |
| Stacked bar | Mix over time (status mix, material mix) |
| Pie / donut | Share of one total (this month’s revenue by customer) — never trends |
| Number + delta | KPI tile (this period vs last) |
| Table | Exact figures, CSV export |

### Reporting

1. **Live dashboard** in the admin app (feature-flagged) — planning default.
2. **CSV** of the same query (the download route already exists; do not overload it forever — ADR-0007).
3. **Saved views** (which metrics + grain + range) in Postgres so planning meetings are reproducible.
4. **Scheduled email** only after 1–3 are trusted; Postmark + pg-boss already send operational mail.

### Three scales (pick by pain, not fashion)

| Scale | When | Stack |
|-------|------|-------|
| **A. In-app SQL + charts** | Now. Internal users, modest rows, known questions. | `app/lib/analytics` + Remix + Recharts. Optional matviews. |
| **B. Semantic layer + Postgres** | Many charts, or Metabase + app must match. | SQL views or Cube/Lightdash on a read replica. |
| **C. Warehouse + BI** | Extra sources, analysts, or volume that hurts OLTP. | Replica/CDC → warehouse → dbt metrics → Metabase/Looker. |

We are at **A**, with a cheap option to add **B (Metabase)** without moving data.

---

## 7. Recommended path for this application

### Phase 1 — ship planning analytics in-app

1. Add `app/lib/analytics` as a deep module: catalog of metrics, one query interface, no chart types inside the catalog.
2. Feature-flag a `/analytics` (or `/planning`) route. Do not grow `_protected._index.tsx` / `dashboard.ts` into a warehouse.
3. Implement the metrics in the table below against **current tables**.
4. Index `quotes(created_at)`, `quotes(sent_at)`, `quotes(converted_to_order_id)`, `orders(created_at)`, and line-item foreign keys used in aggregates.
5. Add a chart library. Keep loaders thin: call `queryMetrics`, pass series to charts.
6. Tests at the catalog seam: given fixtures, quote count / AOV / conversion rate are exact literals (TDD on the module, not the route).

### Phase 1b — ad-hoc without building a query builder

Stand up Metabase against a **read-only** Postgres role (Supabase’s documented pairing). Point it at **views** that encode the same catalog (`analytics.quote_facts_daily`, etc.) so click-house exploration cannot invent a second definition of AOV.

### Phase 2 — only if Phase 1 proves the catalog is the bottleneck

If operators need to invent charts weekly, add Cube *or* lean harder on Metabase. Do not add both. If page-load aggregations get slow, materialized views refreshed by pg-boss (Postgres’s own sales-dashboard example).

### Phase 3 — warehouse

Only with a second data source or real OLTP pain.

### Explicitly out of scope for v1

- Time-series DB
- ClickHouse
- PostHog as financial source of truth
- Querying `event_logs` for KPIs
- Unconstrained pivot UI
- Embedding customer-facing analytics (this is an internal admin)

---

## 8. Metric catalog (requested + planning extras)

Each row is a definition to lock before graphing. **Time axis** is the timestamp used for `date_trunc`.

### Requested

| Metric | Grain | Time axis (proposed) | Formula (proposed) | Watch-outs |
|--------|-------|----------------------|--------------------|------------|
| Quote count | Quote | `created_at` (also offer `sent_at`) | `COUNT(*)` | Exclude archived; RFQ vs Draft vs Sent is a dimension, not a separate metric unless named. |
| Average quote value | Quote | same | `AVG(total)` | Null/zero totals; stored `total` vs sum of lines. |
| Quotes converted to orders | Quote | `accepted_at` or order `created_at` | `COUNT(*) FILTER (converted_to_order_id IS NOT NULL)` | Conversion can happen from Sent, not only Accepted (`CONTEXT.md`). |
| Conversion rate | Quote | cohort by `sent_at` | converted / sent | Do not use created drafts as denominator. |
| Conversion frequency | Quote | week of conversion | conversions per week | Different question than rate. |
| Average order value | Order | `created_at` | `AVG(total_price)` | Exclude Cancelled/Archived? Product call. |
| Parts per quote | Quote | quote `created_at` | `AVG(count of quote_parts)` vs `AVG(count of lines)` vs `AVG(SUM(qty))` | Three different numbers — pick the planning one. |
| Parts per order | Order | order `created_at` | same choices on `order_line_items` / `parts` | QuotePart ≠ Part until conversion. |
| Avg $ per part on a quote | Line | quote `created_at` | `AVG(unit_price)` or `SUM(total_price)/SUM(qty)` | Weighted vs unweighted average. |
| Avg $ per part on an order | Line | order `created_at` | `AVG(unit_price)` or `SUM(qty*unit_price)/SUM(qty)` | Order lines have no `total_price` column; compute `qty * unit_price`. |
| Quote part value vs order part value | Line, paired | conversion time | For converted quotes, compare quote line totals to resulting order lines | Needs a stable join through conversion; parts are copied, not the same row. |

### Extra metrics that usually matter for manufacturing planning

| Metric | Why |
|--------|-----|
| Funnel counts: RFQ → Draft → Sent → Accepted / Rejected / Dropped / Expired | Pipeline health; uses accumulating timestamps where they exist. |
| Quote cycle time (`sent_at - created_at`, `accepted_at - sent_at`) | Capacity and process drag. |
| Win rate by customer, vendor, material | Where to spend sales/engineering time. |
| Quote aging (now − `created_at` for open statuses) | Snapshot of stuck work; this *is* current-state. |
| Expiration / rejection rate + `rejection_reason` mix | Quality of quoting. |
| Gross margin: `orders.total_price - vendor_pay` | Pricing vs shop cost. |
| Promised vs actual delivery (`delivery_date*` vs delivered/completed) | Needs better order timestamps to be honest. |
| Open production load (orders in In_Production / In_Inspection) | Shop loading; dashboard already counts some of this. |
| Revenue concentration (top N customers) | Risk. |
| Repeat-order rate | Account health. |
| Email-sent → accepted lag | Uses `sent_emails` + quote timestamps; bonus, not v1. |
| Stripe payment-link conversion | Only for quotes that used links. |

### Dimensions worth slicing by (the “compare different things”)

Time grain, customer, vendor, quote/order status, material/finish (from parts), created-by user, converted vs not. That set covers nearly all planning questions without a generic cube.

---

## 9. How a first implementation should sit in *this* repo

Per the codebase-design vocabulary: one **deep module**, small **interface**, tests at that **seam**.

```
app/lib/analytics/
  catalog.ts      # metric names, grain, time column, SQL fragments
  query.ts        # queryMetrics(input) → series
  types.ts
app/routes/_protected.analytics._index.tsx   # thin loader
app/components/analytics/                    # charts only
```

Callers know: metric ids, grain, range, optional dimensions. They do not know joins, archive filters, or `date_trunc`. That is the same leverage Cube sells, without a second process.

Do not extend `getDashboardStats()` into this. The home tiles are operational “what needs attention today.” Planning analytics is “how did the book of business move.” Different interface.

When a definition is locked, record it in an ADR (backlog: ADR-0011) so “average quote value” cannot drift.

---

## 10. What not to do

- Put heavy `GROUP BY` queries on the same pooled connection as quote/order writes without a timeout.
- Treat `event_logs` as a fact table.
- Duplicate metric SQL in loaders, Metabase questions, and CSV exports.
- Start with Timescale, ClickHouse, or a warehouse “because analytics is time-based.”
- Use PostHog/Mixpanel dollar events as the financial system of record.
- Mix quote-level and line-level averages in one chart.
- Build a fully generic “any field vs any field” explorer before ten named metrics are trusted.
- Drop analytics SQL into `_protected.quotes.$quoteId.tsx`.

---

## Sources

Primary sources only; blogs used only as pointers, not as claims.

### Dimensional modeling

- [Kimball: Grain](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/grain/)
- [Kimball: Declaring the Grain](https://www.kimballgroup.com/2003/03/declaring-the-grain/)
- [Kimball: Fact Tables](https://www.kimballgroup.com/2008/11/fact-tables/)
- [Kimball: Fact Tables and Dimension Tables](https://www.kimballgroup.com/2003/01/fact-tables-and-dimension-tables/)
- [Kimball: Keep to the Grain](https://www.kimballgroup.com/2007/07/keep-to-the-grain-in-dimensional-modeling/)

### Postgres query / cache layer

- [PostgreSQL date/time functions (`date_trunc`)](https://www.postgresql.org/docs/current/functions-datetime.html)
- [PostgreSQL materialized views](https://www.postgresql.org/docs/current/rules-materializedviews.html)

### Semantic layers and BI

- [Cube introduction (semantic layer, APIs)](https://docs.cube.dev/docs/introduction)
- [Cube Postgres data source](https://docs.cube.dev/admin/connect-to-data/data-sources/postgres)
- [Cube REST query format](https://docs.cube.dev/reference/core-data-apis/rest-api/query-format)
- [Cube React client](https://docs.cube.dev/reference/javascript-sdk/react)
- [Cube embedding](https://docs.cube.dev/embedding)
- [Lightdash semantic layer](https://docs.lightdash.com/guides/lightdash-semantic-layer)
- [dbt MetricFlow / Semantic Layer](https://docs.getdbt.com/docs/build/about-metricflow)
- [Metabase embedding introduction](https://www.metabase.com/docs/latest/embedding/introduction)
- [Evidence.dev](https://docs.evidence.dev/)
- [Supabase: connect Metabase](https://supabase.com/docs/guides/database/metabase)
- [Supabase: connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase: read replicas](https://supabase.com/docs/guides/platform/read-replicas)

### OLAP vs OLTP vs time series

- [ClickHouse: what is ClickHouse / OLAP vs OLTP](https://clickhouse.com/docs/get-started/about/intro)
- [Timescale: hypertables](https://docs.timescale.com/use-timescale/latest/hypertables/)
- [InfluxDB 2 get started (time-series examples)](https://docs.influxdata.com/influxdb/v2/get-started/)
- [PostHog product analytics](https://posthog.com/docs/product-analytics)
- [PostHog BI vs product analytics](https://posthog.com/data-stack/business-intelligence)

### This repository

- `CONTEXT.md` — Quote / Order lifecycles, conversion
- `docs/architecture-map.md` — stack, dashboard, events route
- `app/lib/db/schema.ts` — quotes, orders, line items, event_logs
- `app/lib/dashboard.ts` — existing aggregates
- `app/lib/quotes.ts` — `convertQuoteToOrder`, status timestamps
- `app/lib/events.ts` — audit log API
