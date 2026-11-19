import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { EMAIL_CONTEXT } from "../email/email-context-registry";

import { db } from "../db";
import { createTwentyLockClient } from "../db/client";
import { customers, quotes, twentySyncLinks } from "../db/schema";
import type { CompanyChoiceDetail } from "./matching";
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
const lastSendUpdatedAtSql = sql<Date | null>`(select se."updated_at" ${QUOTE_SEND_EMAILS} order by se."id" desc limit 1)`;

/** Any fixed number: it only has to be the same for every Twenty sync. */
const TWENTY_SYNC_LOCK = 7_401_194;

/**
 * Runs one sync at a time across the web and worker processes, so a single-quote
 * sync and a sweep cannot both create the same company. Busy callers skip rather
 * than queue. The transaction exists only to hold the lock; `run` uses its own
 * connections.
 */
export async function withTwentySyncLock<T>(
  run: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  const lockClient = createTwentyLockClient();
  try {
    return await lockClient.begin(async (tx) => {
      const rows = await tx.unsafe("select pg_try_advisory_xact_lock($1) as locked", [TWENTY_SYNC_LOCK]);
      if (!rows[0]?.locked) return { ran: false as const };
      return { ran: true as const, value: await run() };
    });
  } finally {
    await lockClient.end();
  }
}

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
      // A failure can land on a row whose version is already synced, as when a
      // single-quote sync fails. It must still retry, or it stays failed for good.
      eq(twentySyncLinks.syncState, "failed"),
    ),
    or(
      isNull(twentySyncLinks.nextAttemptAt),
      lte(twentySyncLinks.nextAttemptAt, now),
      // A change since the last try may be what fixes it, and it should not wait.
      sql`${versionSql} > ${twentySyncLinks.lastAttemptAt}`,
    ),
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
        sentAt: quotes.sentAt,
        lastSendStatus: lastSendStatusSql,
        lastSendUpdatedAt: sql<Date | null>`${lastSendUpdatedAtSql}`.mapWith(quotes.updatedAt),
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

  async saveCustomerLink(customerId, values, now, { invalidateQuotes }) {
    await db.transaction(async (tx) => {
      await saveLink("customer", customerId, values, now, tx);
      if (invalidateQuotes) await invalidateCustomerQuotes(customerId, tx);
    });
  },

  saveQuoteLink: (quoteId, values, now) => saveLink("quote", quoteId, values, now),

  async markFailed({ entityType, entityId }, error, now, detail = null) {
    const link = await postgresTwentySyncStore.getLink(entityType, entityId);
    const attemptCount = (link?.attemptCount ?? 0) + 1;
    const failed = {
      syncState: "failed" as const,
      lastError: error.slice(0, MAX_ERROR_LENGTH),
      failureDetail: detail,
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
};

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The quotes must re-sync to pick up the customer's new company or person. */
async function invalidateCustomerQuotes(customerId: number, tx: DbTransaction) {
  await tx
    .update(twentySyncLinks)
    .set({ syncedSourceUpdatedAt: null })
    .where(
      and(
        eq(twentySyncLinks.entityType, "quote"),
        inArray(
          twentySyncLinks.entityId,
          tx.select({ id: quotes.id }).from(quotes).where(eq(quotes.customerId, customerId)),
        ),
      ),
    );
}

async function saveLink(
  entityType: SyncEntityType,
  entityId: number,
  values: Partial<typeof twentySyncLinks.$inferInsert>,
  now: Date,
  executor: Pick<typeof db, "insert"> = db,
) {
  const synced = {
    ...values,
    syncState: "synced" as const,
    lastError: null,
    failureDetail: null,
    attemptCount: 0,
    lastAttemptAt: now,
    nextAttemptAt: null,
    updatedAt: now,
  };
  await executor
    .insert(twentySyncLinks)
    .values({ entityType, entityId, ...synced })
    .onConflictDoUpdate({
      target: [twentySyncLinks.entityType, twentySyncLinks.entityId],
      set: synced,
    });
}

/** Stored Twenty IDs belong to one workspace, so changing workspace starts them over. */
export async function clearTwentySyncLinks(): Promise<void> {
  await db.delete(twentySyncLinks);
}

/**
 * Records a person's choice of company, either settling a match or correcting one
 * that was wrong. The customer and its existing opportunities re-sync using it, and
 * every record held up by this customer becomes due at once.
 */
export async function saveTwentyCompanyChoice(
  customerId: number,
  companyId: string,
  syncedCompanyKey: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const choice = {
      twentyCompanyId: companyId,
      syncedCompanyKey,
      syncedSourceUpdatedAt: null,
      updatedAt: new Date(),
    };
    await tx
      .insert(twentySyncLinks)
      .values({ entityType: "customer", entityId: customerId, ...choice })
      .onConflictDoUpdate({
        target: [twentySyncLinks.entityType, twentySyncLinks.entityId],
        set: choice,
      });
    await invalidateCustomerQuotes(customerId, tx);
    await tx
      .update(twentySyncLinks)
      .set({ nextAttemptAt: null, failureDetail: null })
      .where(
        and(
          eq(twentySyncLinks.syncState, "failed"),
          sql`(${twentySyncLinks.failureDetail}->>'customerId')::int = ${customerId}`,
        ),
      );
  });
}

/** The saved choice for a customer, so a submitted company can be checked against it. */
export async function getTwentyCompanyChoice(
  customerId: number,
): Promise<CompanyChoiceDetail | null> {
  const [row] = await db
    .select({ detail: twentySyncLinks.failureDetail })
    .from(twentySyncLinks)
    .where(
      and(
        eq(twentySyncLinks.syncState, "failed"),
        sql`(${twentySyncLinks.failureDetail}->>'customerId')::int = ${customerId}`,
      ),
    )
    .limit(1);
  return row?.detail ?? null;
}

export interface TwentySyncFailure {
  entityType: SyncEntityType;
  entityId: number;
  label: string;
  lastError: string | null;
  companyChoice: CompanyChoiceDetail | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
}

export interface TwentySyncWarning {
  customerId: number;
  customerName: string;
  warning: string;
}

export interface TwentySyncOverview {
  syncedQuotes: number;
  /** Every blocked record, as `failures` is capped. */
  failureCount: number;
  /** Records the next run would pick up. */
  pendingCount: number;
  failures: TwentySyncFailure[];
  warnings: TwentySyncWarning[];
}

/** Admin view. Archived records drop out, as the sweep no longer retries them. */
export async function getTwentySyncOverview(
  syncStartedAt: Date | null,
  limit = 50,
): Promise<TwentySyncOverview> {
  const activeFailures = and(
    eq(twentySyncLinks.syncState, "failed"),
    or(isNull(quotes.isArchived), eq(quotes.isArchived, false)),
    or(isNull(customers.isArchived), eq(customers.isArchived, false)),
  );
  const pending = syncStartedAt
    ? await postgresTwentySyncStore.listDue({ now: new Date(), syncStartedAt, limit: 500 })
    : [];

  const failed = await db
    .select({
      entityType: twentySyncLinks.entityType,
      entityId: twentySyncLinks.entityId,
      lastError: twentySyncLinks.lastError,
      failureDetail: twentySyncLinks.failureDetail,
      attemptCount: twentySyncLinks.attemptCount,
      lastAttemptAt: twentySyncLinks.lastAttemptAt,
      nextAttemptAt: twentySyncLinks.nextAttemptAt,
      quoteNumber: quotes.quoteNumber,
      customerName: customers.displayName,
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
    .where(activeFailures)
    .orderBy(desc(twentySyncLinks.lastAttemptAt))
    .limit(limit);

  const [failureTotal] = await db
    .select({ total: sql<number>`count(*)::int` })
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
    .where(activeFailures);

  const warnings = await db
    .select({
      customerId: customers.id,
      customerName: customers.displayName,
      warning: twentySyncLinks.syncWarning,
    })
    .from(twentySyncLinks)
    .innerJoin(
      customers,
      and(
        eq(twentySyncLinks.entityType, "customer"),
        eq(twentySyncLinks.entityId, customers.id),
      ),
    )
    .where(and(isNotNull(twentySyncLinks.syncWarning), eq(customers.isArchived, false)))
    .orderBy(asc(customers.displayName))
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
    failureCount: failureTotal?.total ?? 0,
    pendingCount: pending.length,
    failures: failed.map((row) => ({
      entityType: row.entityType,
      entityId: row.entityId,
      label: row.quoteNumber ?? row.customerName ?? `${row.entityType} ${row.entityId}`,
      lastError: row.lastError,
      companyChoice: row.failureDetail ?? null,
      attemptCount: row.attemptCount,
      lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    })),
    warnings: warnings.map((row) => ({
      customerId: row.customerId,
      customerName: row.customerName,
      warning: row.warning ?? "",
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
