import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { EMAIL_CONTEXT } from "../email/email-context-registry";

import { db } from "../db";
import { customers, quotes, twentySyncLinks } from "../db/schema";
import {
  retryDelayMinutes,
  type DueRecord,
  type SyncEntityType,
  type TwentySyncStore,
} from "./sync.server";

const MAX_ERROR_LENGTH = 1000;

/**
 * Timestamps read through JS Dates lose Postgres' microseconds. Reading and
 * comparing at millisecond precision keeps a synced row from looking changed.
 */
function versionOf(column: typeof customers.updatedAt) {
  return sql<Date>`date_trunc('milliseconds', ${column})`.mapWith(column);
}

/**
 * Priced quote emails only. Delivery updates the email row, never the quote, so
 * it has to count towards the quote's version for the sweep to notice it.
 * Literal SQL: Drizzle strips table prefixes from columns in single-table selects.
 */
const QUOTE_SEND_EMAILS = sql.raw(
  `from "sent_emails" se where se."quote_id" = "quotes"."id" and se."context_key" = '${EMAIL_CONTEXT.QUOTE_SEND}'`,
);
const quoteVersionSql = sql`date_trunc('milliseconds', greatest("quotes"."updated_at", (select max(se."updated_at") ${QUOTE_SEND_EMAILS})))`;
const lastSendStatusSql = sql<string | null>`(select se."status"::text ${QUOTE_SEND_EMAILS} order by se."id" desc limit 1)`;

/**
 * Created at or after an instant, independent of the session timezone. Stored
 * values are UTC wall-clock time, from Drizzle and from the utcNow column default.
 */
export function createdAtOrAfter(column: AnyPgColumn, instant: Date) {
  return sql`(${column} at time zone 'UTC') >= ${instant.toISOString()}::timestamptz`;
}

function dueConditions(
  entity: { createdAt: AnyPgColumn; isArchived: AnyPgColumn },
  versionSql: SQL,
  { now, syncStartedAt }: { now: Date; syncStartedAt: Date },
) {
  return and(
    eq(entity.isArchived, false),
    // Older rows wait for the separate backfill unless already linked.
    or(createdAtOrAfter(entity.createdAt, syncStartedAt), isNotNull(twentySyncLinks.entityId)),
    or(
      isNull(twentySyncLinks.syncedSourceUpdatedAt),
      sql`${versionSql} > ${twentySyncLinks.syncedSourceUpdatedAt}`,
    ),
    or(isNull(twentySyncLinks.nextAttemptAt), lte(twentySyncLinks.nextAttemptAt, now)),
  );
}

const leastRecentlyAttempted = sql`${twentySyncLinks.lastAttemptAt} asc nulls first`;

export const postgresTwentySyncStore: TwentySyncStore = {
  async listDue({ now, syncStartedAt, limit }) {
    const [dueQuotes, dueCustomers] = await Promise.all([
      db
        .select({ id: quotes.id, lastAttemptAt: twentySyncLinks.lastAttemptAt })
        .from(quotes)
        .leftJoin(
          twentySyncLinks,
          and(
            eq(twentySyncLinks.entityType, "quote"),
            eq(twentySyncLinks.entityId, quotes.id),
          ),
        )
        .where(dueConditions(quotes, quoteVersionSql, { now, syncStartedAt }))
        .orderBy(leastRecentlyAttempted, asc(quotes.updatedAt))
        .limit(limit),
      db
        .select({ id: customers.id, lastAttemptAt: twentySyncLinks.lastAttemptAt })
        .from(customers)
        .leftJoin(
          twentySyncLinks,
          and(
            eq(twentySyncLinks.entityType, "customer"),
            eq(twentySyncLinks.entityId, customers.id),
          ),
        )
        .where(
          dueConditions(
            customers,
            sql`date_trunc('milliseconds', ${customers.updatedAt})`,
            { now, syncStartedAt },
          ),
        )
        .orderBy(leastRecentlyAttempted, asc(customers.updatedAt))
        .limit(limit),
    ]);

    const rank = (row: { lastAttemptAt: Date | null }) =>
      row.lastAttemptAt?.getTime() ?? 0;
    const merged: Array<DueRecord & { lastAttemptAt: Date | null }> = [
      ...dueCustomers.map((row) => ({
        entityType: "customer" as const,
        entityId: row.id,
        lastAttemptAt: row.lastAttemptAt,
      })),
      ...dueQuotes.map((row) => ({
        entityType: "quote" as const,
        entityId: row.id,
        lastAttemptAt: row.lastAttemptAt,
      })),
    ];
    return merged
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, limit)
      .map(({ entityType, entityId }) => ({ entityType, entityId }));
  },

  async getCustomer(id) {
    const [row] = await db
      .select({
        id: customers.id,
        displayName: customers.displayName,
        companyName: customers.companyName,
        contactName: customers.contactName,
        title: customers.title,
        email: customers.email,
        phone: customers.phone,
        updatedAt: versionOf(customers.updatedAt),
      })
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);
    return row ?? null;
  },

  async getQuote(id) {
    const [row] = await db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        customerId: quotes.customerId,
        status: quotes.status,
        total: quotes.total,
        updatedAt: sql<Date>`${quoteVersionSql}`.mapWith(quotes.updatedAt),
        lastSendStatus: lastSendStatusSql,
      })
      .from(quotes)
      .where(eq(quotes.id, id))
      .limit(1);
    return row ?? null;
  },

  async findQuoteByNumber(quoteNumber) {
    const [row] = await db
      .select({ id: quotes.id, isArchived: quotes.isArchived })
      .from(quotes)
      .where(eq(quotes.quoteNumber, quoteNumber))
      .limit(1);
    return row ?? null;
  },

  async getLink(entityType, entityId) {
    const [row] = await db
      .select()
      .from(twentySyncLinks)
      .where(
        and(
          eq(twentySyncLinks.entityType, entityType),
          eq(twentySyncLinks.entityId, entityId),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  saveCustomerLink: (customerId, values, now) =>
    saveLink("customer", customerId, values, now),

  saveQuoteLink: (quoteId, values, now) => saveLink("quote", quoteId, values, now),

  async markFailed({ entityType, entityId }, error, now) {
    const link = await postgresTwentySyncStore.getLink(entityType, entityId);
    const attemptCount = (link?.attemptCount ?? 0) + 1;
    const failed = {
      syncState: "failed" as const,
      lastError: error.slice(0, MAX_ERROR_LENGTH),
      attemptCount,
      lastAttemptAt: now,
      nextAttemptAt: new Date(
        now.getTime() + retryDelayMinutes(attemptCount) * 60_000,
      ),
      updatedAt: now,
    };
    await db
      .insert(twentySyncLinks)
      .values({ entityType, entityId, ...failed })
      .onConflictDoUpdate({
        target: [twentySyncLinks.entityType, twentySyncLinks.entityId],
        set: failed,
      });
  },

  async invalidateCustomerQuotes(customerId) {
    await db
      .update(twentySyncLinks)
      .set({ syncedSourceUpdatedAt: null })
      .where(
        and(
          eq(twentySyncLinks.entityType, "quote"),
          inArray(
            twentySyncLinks.entityId,
            db
              .select({ id: quotes.id })
              .from(quotes)
              .where(eq(quotes.customerId, customerId)),
          ),
        ),
      );
  },
};

async function saveLink(
  entityType: SyncEntityType,
  entityId: number,
  values: Partial<typeof twentySyncLinks.$inferInsert>,
  now: Date,
) {
  const synced = {
    ...values,
    syncState: "synced" as const,
    lastError: null,
    attemptCount: 0,
    lastAttemptAt: now,
    nextAttemptAt: null,
    updatedAt: now,
  };
  await db
    .insert(twentySyncLinks)
    .values({ entityType, entityId, ...synced })
    .onConflictDoUpdate({
      target: [twentySyncLinks.entityType, twentySyncLinks.entityId],
      set: synced,
    });
}

export interface TwentySyncFailure {
  entityType: SyncEntityType;
  entityId: number;
  label: string;
  lastError: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
}

export interface TwentySyncOverview {
  syncedQuotes: number;
  failures: TwentySyncFailure[];
}

/** Admin view. Archived records drop out, as the sweep no longer retries them. */
export async function getTwentySyncOverview(limit = 50): Promise<TwentySyncOverview> {
  const failed = await db
    .select({
      entityType: twentySyncLinks.entityType,
      entityId: twentySyncLinks.entityId,
      lastError: twentySyncLinks.lastError,
      attemptCount: twentySyncLinks.attemptCount,
      lastAttemptAt: twentySyncLinks.lastAttemptAt,
      nextAttemptAt: twentySyncLinks.nextAttemptAt,
      quoteNumber: quotes.quoteNumber,
      quoteArchived: quotes.isArchived,
      customerName: customers.displayName,
      customerArchived: customers.isArchived,
    })
    .from(twentySyncLinks)
    .leftJoin(
      quotes,
      and(eq(twentySyncLinks.entityType, "quote"), eq(twentySyncLinks.entityId, quotes.id)),
    )
    .leftJoin(
      customers,
      and(
        eq(twentySyncLinks.entityType, "customer"),
        eq(twentySyncLinks.entityId, customers.id),
      ),
    )
    .where(eq(twentySyncLinks.syncState, "failed"))
    .orderBy(desc(twentySyncLinks.lastAttemptAt))
    .limit(limit);

  const [counts] = await db
    .select({ synced: sql<number>`count(*)::int` })
    .from(twentySyncLinks)
    .where(
      and(
        eq(twentySyncLinks.entityType, "quote"),
        eq(twentySyncLinks.syncState, "synced"),
      ),
    );

  return {
    syncedQuotes: counts?.synced ?? 0,
    failures: failed
      .filter((row) => !row.quoteArchived && !row.customerArchived)
      .map((row) => ({
        entityType: row.entityType,
        entityId: row.entityId,
        label:
          row.quoteNumber ?? row.customerName ?? `${row.entityType} ${row.entityId}`,
        lastError: row.lastError,
        attemptCount: row.attemptCount,
        lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
        nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
      })),
  };
}

/** Makes failed records due on the next run: one record, or all when none is given. */
export async function clearTwentyRetryDelay(record?: DueRecord): Promise<void> {
  await db
    .update(twentySyncLinks)
    .set({ nextAttemptAt: null })
    .where(
      and(
        eq(twentySyncLinks.syncState, "failed"),
        record ? eq(twentySyncLinks.entityType, record.entityType) : undefined,
        record ? eq(twentySyncLinks.entityId, record.entityId) : undefined,
      ),
    );
}
