import { and, eq, inArray, max, sql } from "drizzle-orm";

import {
  resolveFinalCustomerId,
  resolveSatisfiedCustomerMatchReviews,
  type DbExecutor,
} from "./customer-match-review.server";
import { CustomerMergeError } from "./customer-merge-error";
import {
  compareFields,
  resolveFieldUpdates,
  type CustomerRow,
  type FieldAutoFill,
  type FieldConflict,
  type MergeChoices,
} from "./customer-merge-fields";
import type { DuplicateReasonKind } from "./customer-merge-view";
import {
  normalizeCompanyName,
  normalizeContactName,
  normalizePhoneDigits,
} from "./customer-normalize";
import { db } from "./db";
import {
  customerAttachments,
  customerCommunications,
  customerEmailAliases,
  customers,
  notes,
  orders,
  parts,
  quotes,
  type UserRole,
} from "./db/schema";
import { normalizeEmail } from "./email-normalize";
import { createEvent } from "./events";


export type MergeActor = {
  userId: string;
  email?: string | null;
  role: UserRole;
};

function requireElevated(actor: MergeActor) {
  if (actor.role !== "Admin" && actor.role !== "Dev") {
    throw new CustomerMergeError("Admin or Dev role required", 403);
  }
}

// ---------------------------------------------------------------------------
// Finding duplicates
// ---------------------------------------------------------------------------

export type { DuplicateReasonKind };

export type DuplicateReason = { kind: DuplicateReasonKind; value: string };

export type CustomerSummary = {
  id: number;
  displayName: string;
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  /** Normalized primary email plus every alias. */
  emails: string[];
  quoteCount: number;
  orderCount: number;
  lastActivityAt: Date | null;
  createdAt: Date;
};

/** Two active Customers that look alike, and which signals they share. */
export type DuplicatePair = {
  a: CustomerSummary;
  b: CustomerSummary;
  reasons: DuplicateReason[];
  /** Higher is more likely a real duplicate. See `SIGNAL_WEIGHTS`. */
  score: number;
};

export type DuplicateSuggestions = {
  /** The requested page of pairs, best match first. */
  pairs: DuplicatePair[];
  /** Pairs matching the requested filters (before paging). */
  total: number;
  /** Pairs sharing each signal, ignoring the requested filters. */
  kindCounts: Record<DuplicateReasonKind, number>;
};

type Signal = DuplicateReason;

/** How strongly each kind of match suggests a duplicate. Kinds add up. */
const SIGNAL_WEIGHTS: Record<DuplicateReasonKind, number> = {
  email: 100,
  phone: 45,
  company: 35,
  name: 30,
};

/**
 * A company, phone or name shared by more Customers than this is too generic
 * ("N/A", a switchboard number) to say anything about any one pair.
 */
const MAX_LOOSE_SIGNAL_GROUP = 25;

const signalKey = (signal: Signal) => `${signal.kind}\u0000${signal.value}`;
const orderedPairKey = (a: number, b: number) =>
  a < b ? `${a}:${b}` : `${b}:${a}`;

function signalsOf(customer: CustomerSummary): Signal[] {
  const signals: Signal[] = customer.emails.map((value) => ({
    kind: "email" as const,
    value,
  }));
  const company = normalizeCompanyName(customer.companyName);
  if (company) signals.push({ kind: "company", value: company });
  const phone = normalizePhoneDigits(customer.phone);
  if (phone) signals.push({ kind: "phone", value: phone });
  const name = normalizeContactName(customer.contactName);
  if (name) signals.push({ kind: "name", value: name });
  return signals;
}

const sortReasons = (reasons: DuplicateReason[]) =>
  [...reasons].sort(
    (x, y) => x.kind.localeCompare(y.kind) || x.value.localeCompare(y.value),
  );

function scoreOf(reasons: DuplicateReason[]): number {
  return [...new Set(reasons.map((reason) => reason.kind))].reduce(
    (total, kind) => total + SIGNAL_WEIGHTS[kind],
    0,
  );
}

function sharedSignals(a: CustomerSummary, b: CustomerSummary): DuplicateReason[] {
  const inB = new Set(signalsOf(b).map(signalKey));
  return sortReasons(signalsOf(a).filter((signal) => inB.has(signalKey(signal))));
}

function latestActivity(pair: DuplicatePair): number {
  return Math.max(
    0,
    pair.a.lastActivityAt?.getTime() ?? 0,
    pair.b.lastActivityAt?.getTime() ?? 0,
  );
}

const bestMatchFirst = (x: DuplicatePair, y: DuplicatePair) =>
  y.score - x.score ||
  latestActivity(y) - latestActivity(x) ||
  x.a.id - y.a.id ||
  x.b.id - y.b.id;

/**
 * Suggest pairs of active Customers that look like duplicates, best match
 * first. `kinds` narrows the list to pairs that share EVERY listed signal.
 * Archived Customers never appear.
 */
export async function findDuplicatePairs(
  options: {
    kinds?: DuplicateReasonKind[];
    limit?: number;
    offset?: number;
  } = {},
): Promise<DuplicateSuggestions> {
  const summaries = await loadSummaries(db, "active");

  const idsBySignal = new Map<string, { signal: Signal; ids: number[] }>();
  for (const customer of summaries.values()) {
    for (const signal of signalsOf(customer)) {
      const key = signalKey(signal);
      const entry = idsBySignal.get(key) ?? { signal, ids: [] };
      entry.ids.push(customer.id);
      idsBySignal.set(key, entry);
    }
  }

  const reasonsByPair = new Map<
    string,
    { lowId: number; highId: number; reasons: DuplicateReason[] }
  >();
  for (const { signal, ids } of idsBySignal.values()) {
    if (ids.length < 2) continue;
    if (signal.kind !== "email" && ids.length > MAX_LOOSE_SIGNAL_GROUP) continue;
    const sorted = [...ids].sort((x, y) => x - y);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = orderedPairKey(sorted[i], sorted[j]);
        const entry = reasonsByPair.get(key) ?? {
          lowId: sorted[i],
          highId: sorted[j],
          reasons: [],
        };
        entry.reasons.push(signal);
        reasonsByPair.set(key, entry);
      }
    }
  }

  const kindCounts: Record<DuplicateReasonKind, number> = {
    email: 0,
    phone: 0,
    company: 0,
    name: 0,
  };
  const wanted = [...new Set(options.kinds ?? [])];
  const matching: DuplicatePair[] = [];
  for (const { lowId, highId, reasons } of reasonsByPair.values()) {
    const present = new Set(reasons.map((reason) => reason.kind));
    for (const kind of present) kindCounts[kind] += 1;
    if (!wanted.every((kind) => present.has(kind))) continue;
    matching.push({
      a: summaries.get(lowId)!,
      b: summaries.get(highId)!,
      reasons: sortReasons(reasons),
      score: scoreOf(reasons),
    });
  }
  matching.sort(bestMatchFirst);

  const offset = Math.max(0, options.offset ?? 0);
  const end = options.limit === undefined ? undefined : offset + Math.max(0, options.limit);
  return { pairs: matching.slice(offset, end), total: matching.length, kindCounts };
}

/**
 * Every pair among `customers`, with whatever each pair shares (possibly
 * nothing). Used to pre-load the merge tool from an Action Item, where the
 * candidates were matched at intake and may share nothing obvious.
 */
export function pairsAmong(customers: CustomerSummary[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < customers.length; i++) {
    for (let j = i + 1; j < customers.length; j++) {
      const [a, b] =
        customers[i].id < customers[j].id
          ? [customers[i], customers[j]]
          : [customers[j], customers[i]];
      const reasons = sharedSignals(a, b);
      pairs.push({ a, b, reasons, score: scoreOf(reasons) });
    }
  }
  return pairs.sort(bestMatchFirst);
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

type Executor = DbExecutor;


export type MergeCounts = {
  quotes: number;
  orders: number;
  parts: number;
  /** Attachments that will be linked to the survivor (excludes already-linked). */
  attachments: number;
  communications: number;
  notes: number;
};

export type MergePreview = {
  survivor: CustomerSummary;
  merged: CustomerSummary;
  counts: MergeCounts;
  /** Merged Customer's attachments the survivor already has; they link once. */
  attachmentsAlreadyLinked: number;
  /** Alias emails the survivor will hold after the merge. */
  retainedEmails: string[];
  conflicts: FieldConflict[];
  autoFills: FieldAutoFill[];
  /** Pass back to `mergeCustomers` to refuse a merge against stale data. */
  survivorUpdatedAt: Date;
  mergedUpdatedAt: Date;
};

export type MergeResult = {
  survivorId: number;
  mergedId: number;
  counts: MergeCounts;
  attachmentsAlreadyLinked: number;
};

export type MergeInput = {
  survivorId: number;
  mergedId: number;
  choices?: MergeChoices;
  expected?: { survivorUpdatedAt: Date; mergedUpdatedAt: Date };
};

type SummaryScope = { ids: number[] } | "active";

/** Build Customer summaries for specific ids, or for every active Customer. */
async function loadSummaries(
  executor: Executor,
  scope: SummaryScope,
): Promise<Map<number, CustomerSummary>> {
  const inScope =
    scope === "active"
      ? eq(customers.isArchived, false)
      : inArray(customers.id, scope.ids);

  const [rows, aliasRows, quoteStats, orderStats] = await Promise.all([
    executor.select().from(customers).where(inScope).orderBy(customers.id),
    executor
      .select({
        customerId: customerEmailAliases.customerId,
        email: customerEmailAliases.email,
      })
      .from(customerEmailAliases)
      .innerJoin(customers, eq(customers.id, customerEmailAliases.customerId))
      .where(inScope),
    executor
      .select({
        customerId: quotes.customerId,
        total: sql<number>`count(*)::int`,
        latest: max(quotes.createdAt),
      })
      .from(quotes)
      .innerJoin(customers, eq(customers.id, quotes.customerId))
      .where(inScope)
      .groupBy(quotes.customerId),
    executor
      .select({
        customerId: orders.customerId,
        total: sql<number>`count(*)::int`,
        latest: max(orders.createdAt),
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(inScope)
      .groupBy(orders.customerId),
  ]);

  const aliasesByCustomer = new Map<number, string[]>();
  for (const alias of aliasRows) {
    const normalized = normalizeEmail(alias.email);
    if (!normalized) continue;
    aliasesByCustomer.set(alias.customerId, [
      ...(aliasesByCustomer.get(alias.customerId) ?? []),
      normalized,
    ]);
  }
  const quoteByCustomer = new Map(quoteStats.map((row) => [row.customerId, row]));
  const orderByCustomer = new Map(orderStats.map((row) => [row.customerId, row]));

  return new Map(
    rows.map((customer) => {
      const emails = new Set(aliasesByCustomer.get(customer.id) ?? []);
      const primary = normalizeEmail(customer.email);
      if (primary) emails.add(primary);
      const quoteRow = quoteByCustomer.get(customer.id);
      const orderRow = orderByCustomer.get(customer.id);
      const latest = [quoteRow?.latest, orderRow?.latest]
        .filter((value): value is Date => value instanceof Date)
        .sort((x, y) => y.getTime() - x.getTime())[0];
      return [
        customer.id,
        {
          id: customer.id,
          displayName: customer.displayName,
          companyName: customer.companyName,
          contactName: customer.contactName,
          email: customer.email,
          phone: customer.phone,
          emails: [...emails].sort(),
          quoteCount: Number(quoteRow?.total ?? 0),
          orderCount: Number(orderRow?.total ?? 0),
          lastActivityAt: latest ?? null,
          createdAt: customer.createdAt,
        },
      ];
    }),
  );
}

async function countMovableRecords(
  executor: Executor,
  survivorId: number,
  mergedId: number,
): Promise<{ counts: MergeCounts; attachmentsAlreadyLinked: number }> {
  const [row] = await executor.execute<{
    quotes: number;
    orders: number;
    parts: number;
    communications: number;
    notes: number;
    attachments: number;
    attachments_already_linked: number;
  }>(sql`
    select
      (select count(*)::int from quotes where customer_id = ${mergedId}) as quotes,
      (select count(*)::int from orders where customer_id = ${mergedId}) as orders,
      (select count(*)::int from parts where customer_id = ${mergedId}) as parts,
      (select count(*)::int from customer_communications where customer_id = ${mergedId}) as communications,
      (select count(*)::int from notes where entity_type = 'customer' and entity_id = ${String(mergedId)}) as notes,
      (select count(*)::int from customer_attachments m
        where m.customer_id = ${mergedId}
          and not exists (
            select 1 from customer_attachments s
            where s.customer_id = ${survivorId} and s.attachment_id = m.attachment_id
          )) as attachments,
      (select count(*)::int from customer_attachments m
        where m.customer_id = ${mergedId}
          and exists (
            select 1 from customer_attachments s
            where s.customer_id = ${survivorId} and s.attachment_id = m.attachment_id
          )) as attachments_already_linked
  `);
  return {
    counts: {
      quotes: row.quotes,
      orders: row.orders,
      parts: row.parts,
      attachments: row.attachments,
      communications: row.communications,
      notes: row.notes,
    },
    attachmentsAlreadyLinked: row.attachments_already_linked,
  };
}

function assertMergeable(
  survivor: CustomerRow | undefined,
  merged: CustomerRow | undefined,
) {
  if (!survivor || !merged) {
    throw new CustomerMergeError("Customer not found", 404);
  }
  if (merged.isArchived && merged.mergedIntoCustomerId !== null) {
    throw new CustomerMergeError("That Customer was already merged into another Customer", 409);
  }
  if (survivor.isArchived || merged.isArchived) {
    throw new CustomerMergeError("Archived Customers cannot be merged", 409);
  }
}

/** What a merge would move and which fields conflict. Changes nothing. */
export async function previewMerge(input: {
  survivorId: number;
  mergedId: number;
}): Promise<MergePreview> {
  if (input.survivorId === input.mergedId) {
    throw new CustomerMergeError("A Customer cannot be merged into itself", 400);
  }
  const rows = await db
    .select()
    .from(customers)
    .where(inArray(customers.id, [input.survivorId, input.mergedId]));
  const survivor = rows.find((row) => row.id === input.survivorId);
  const merged = rows.find((row) => row.id === input.mergedId);
  assertMergeable(survivor, merged);

  const [summaries, moved] = await Promise.all([
    loadSummaries(db, { ids: [input.survivorId, input.mergedId] }),
    countMovableRecords(db, input.survivorId, input.mergedId),
  ]);
  const survivorSummary = summaries.get(input.survivorId)!;
  const mergedSummary = summaries.get(input.mergedId)!;
  const { conflicts, autoFills } = compareFields(survivor!, merged!);

  return {
    survivor: survivorSummary,
    merged: mergedSummary,
    counts: moved.counts,
    attachmentsAlreadyLinked: moved.attachmentsAlreadyLinked,
    retainedEmails: [
      ...new Set([...survivorSummary.emails, ...mergedSummary.emails]),
    ].sort(),
    conflicts,
    autoFills,
    survivorUpdatedAt: survivor!.updatedAt,
    mergedUpdatedAt: merged!.updatedAt,
  };
}

/**
 * Move every record of `mergedId` onto `survivorId`, keep its emails as
 * aliases on the survivor, then soft-archive it with a pointer to the survivor.
 * All-or-nothing.
 */
export async function mergeCustomers(
  input: MergeInput,
  actor: MergeActor,
): Promise<MergeResult> {
  requireElevated(actor);
  const { survivorId, mergedId } = input;
  if (survivorId === mergedId) {
    throw new CustomerMergeError("A Customer cannot be merged into itself", 400);
  }

  return db.transaction(async (tx) => {
    // Lock in id order so concurrent merges of the same pair cannot deadlock.
    const locked = await tx
      .select()
      .from(customers)
      .where(inArray(customers.id, [survivorId, mergedId]))
      .orderBy(customers.id)
      .for("update");
    const survivor = locked.find((row) => row.id === survivorId);
    const merged = locked.find((row) => row.id === mergedId);
    assertMergeable(survivor, merged);
    if (
      input.expected &&
      (survivor!.updatedAt.getTime() !== input.expected.survivorUpdatedAt.getTime() ||
        merged!.updatedAt.getTime() !== input.expected.mergedUpdatedAt.getTime())
    ) {
      throw new CustomerMergeError(
        "A Customer changed while you were reviewing. Reload and review again.",
        409,
      );
    }

    const fieldUpdates = resolveFieldUpdates(survivor!, merged!, input.choices ?? {});
    const now = new Date();

    const movedQuotes = await tx
      .update(quotes)
      .set({ customerId: survivorId })
      .where(eq(quotes.customerId, mergedId))
      .returning({ id: quotes.id });
    const movedOrders = await tx
      .update(orders)
      .set({ customerId: survivorId })
      .where(eq(orders.customerId, mergedId))
      .returning({ id: orders.id });
    const movedParts = await tx
      .update(parts)
      .set({ customerId: survivorId })
      .where(eq(parts.customerId, mergedId))
      .returning({ id: parts.id });
    const movedCommunications = await tx
      .update(customerCommunications)
      .set({ customerId: survivorId })
      .where(eq(customerCommunications.customerId, mergedId))
      .returning({ id: customerCommunications.id });
    const movedNotes = await tx
      .update(notes)
      .set({ entityId: String(survivorId) })
      .where(
        and(eq(notes.entityType, "customer"), eq(notes.entityId, String(mergedId))),
      )
      .returning({ id: notes.id });

    // The composite key (customer, attachment) would collide for a file linked
    // to both Customers, so drop the merged side's duplicate link first.
    const alreadyLinked = await tx
      .delete(customerAttachments)
      .where(
        and(
          eq(customerAttachments.customerId, mergedId),
          inArray(
            customerAttachments.attachmentId,
            tx
              .select({ id: customerAttachments.attachmentId })
              .from(customerAttachments)
              .where(eq(customerAttachments.customerId, survivorId)),
          ),
        ),
      )
      .returning({ attachmentId: customerAttachments.attachmentId });
    const movedAttachments = await tx
      .update(customerAttachments)
      .set({ customerId: survivorId })
      .where(eq(customerAttachments.customerId, mergedId))
      .returning({ attachmentId: customerAttachments.attachmentId });

    // Keep every email either Customer was known by, as aliases of the survivor.
    const mergedAliases = await tx
      .select({ email: customerEmailAliases.email })
      .from(customerEmailAliases)
      .where(eq(customerEmailAliases.customerId, mergedId));
    const retainedEmails = new Set<string>();
    for (const email of [
      survivor!.email,
      merged!.email,
      ...mergedAliases.map((alias) => alias.email),
    ]) {
      const normalized = normalizeEmail(email);
      if (normalized) retainedEmails.add(normalized);
    }
    if (retainedEmails.size > 0) {
      await tx
        .insert(customerEmailAliases)
        .values([...retainedEmails].map((email) => ({ customerId: survivorId, email })))
        .onConflictDoNothing();
    }
    await tx
      .delete(customerEmailAliases)
      .where(eq(customerEmailAliases.customerId, mergedId));

    await tx
      .update(customers)
      .set({ ...fieldUpdates, updatedAt: now })
      .where(eq(customers.id, survivorId));
    await tx
      .update(customers)
      .set({ isArchived: true, mergedIntoCustomerId: survivorId, updatedAt: now })
      .where(eq(customers.id, mergedId));

    const counts: MergeCounts = {
      quotes: movedQuotes.length,
      orders: movedOrders.length,
      parts: movedParts.length,
      attachments: movedAttachments.length,
      communications: movedCommunications.length,
      notes: movedNotes.length,
    };

    await createEvent(
      {
        entityType: "customer",
        entityId: String(survivorId),
        eventType: "customers_merged",
        eventCategory: "system",
        title: `Merged "${merged!.displayName}" into "${survivor!.displayName}"`,
        description: `Customer ${mergedId} was merged into Customer ${survivorId} and archived.`,
        metadata: {
          survivorId,
          mergedId,
          counts,
          attachmentsAlreadyLinked: alreadyLinked.length,
          choices: input.choices ?? {},
          retainedEmails: [...retainedEmails].sort(),
          moved: {
            quotes: movedQuotes.map((row) => row.id),
            orders: movedOrders.map((row) => row.id),
            parts: movedParts.map((row) => row.id),
            communications: movedCommunications.map((row) => row.id),
            notes: movedNotes.map((row) => row.id),
            attachments: movedAttachments.map((row) => row.attachmentId),
          },
        },
        userId: actor.userId,
        userEmail: actor.email ?? undefined,
      },
      tx,
    );

    await resolveSatisfiedCustomerMatchReviews(tx, {
      resolvedBy: actor.userId,
      now,
    });

    return {
      survivorId,
      mergedId,
      counts,
      attachmentsAlreadyLinked: alreadyLinked.length,
    };
  });
}

/**
 * Summaries of the active Customers behind `ids`: merged-away Customers are
 * replaced by their final survivor and duplicates collapse. Used to pre-load
 * the merge tool from an Action Item.
 */
export async function getActiveCustomerSummaries(
  ids: number[],
): Promise<CustomerSummary[]> {
  const finalIds = [
    ...new Set(
      (await Promise.all(ids.map((id) => resolveFinalCustomerId(id)))).filter(
        (id): id is number => id !== null,
      ),
    ),
  ];
  if (finalIds.length === 0) return [];
  const summaries = await loadSummaries(db, { ids: finalIds });
  return finalIds.flatMap((id) => summaries.get(id) ?? []);
}
