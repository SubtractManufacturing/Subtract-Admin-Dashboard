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
import {
  customerPairKey,
  type DuplicateReasonKind,
} from "./customer-merge-view";
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
  customerMergeDismissals,
  customers,
  notes,
  orders,
  parts,
  quotes,
  users,
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

export type DismissedPair = {
  lowCustomerId: number;
  highCustomerId: number;
  dismissedBy: string | null;
  /** The dismisser's name (or email) for display. */
  dismissedByLabel: string | null;
  dismissedAt: Date;
};

export type DuplicateGroup = {
  customers: CustomerSummary[];
  reasons: DuplicateReason[];
  /** Pairs inside this group that staff marked "not duplicates". */
  dismissedPairs: DismissedPair[];
};

export type DuplicateGroups = {
  /** High confidence: normalized primary email or alias coincides. */
  sameEmail: DuplicateGroup[];
  /** Lower confidence: same company name, phone digits, or contact name. */
  possible: DuplicateGroup[];
};

type Signal = DuplicateReason;

const pairKey = customerPairKey;
const signalKey = (signal: Signal) => `${signal.kind}\u0000${signal.value}`;

/**
 * Connected components over customers that share a signal. Pairs in
 * `excludedPairs` do not count as a link between their two Customers.
 */
function groupBySharedSignals(
  signalsByCustomer: Map<number, Signal[]>,
  excludedPairs: Set<string>,
): Array<{ customerIds: number[]; reasons: DuplicateReason[] }> {
  const customersBySignal = new Map<string, { signal: Signal; ids: number[] }>();
  for (const [customerId, signals] of signalsByCustomer) {
    for (const signal of signals) {
      const key = signalKey(signal);
      const entry = customersBySignal.get(key) ?? { signal, ids: [] };
      if (!entry.ids.includes(customerId)) entry.ids.push(customerId);
      customersBySignal.set(key, entry);
    }
  }

  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let root = parent.get(id) ?? id;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(Math.max(rootA, rootB), Math.min(rootA, rootB));
  };

  const linkingSignals: Array<{ signal: Signal; ids: number[] }> = [];
  for (const entry of customersBySignal.values()) {
    const linked = new Set<number>();
    for (let i = 0; i < entry.ids.length; i++) {
      for (let j = i + 1; j < entry.ids.length; j++) {
        if (excludedPairs.has(pairKey(entry.ids[i], entry.ids[j]))) continue;
        union(entry.ids[i], entry.ids[j]);
        linked.add(entry.ids[i]);
        linked.add(entry.ids[j]);
      }
    }
    if (linked.size > 0) {
      linkingSignals.push({ signal: entry.signal, ids: [...linked] });
    }
  }

  const components = new Map<number, number[]>();
  for (const customerId of signalsByCustomer.keys()) {
    const root = find(customerId);
    components.set(root, [...(components.get(root) ?? []), customerId]);
  }

  return [...components.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([root, ids]) => ({
      customerIds: ids.sort((a, b) => a - b),
      reasons: linkingSignals
        .filter(({ ids: linked }) => find(linked[0]) === root)
        .map(({ signal }) => signal)
        .sort(
          (a, b) =>
            a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value),
        ),
    }));
}

/**
 * Suggest duplicate Customer groups. Archived Customers never appear. Dismissed
 * pairs are skipped unless `includeDismissed` is set.
 */
export async function findDuplicateGroups(
  options: { includeDismissed?: boolean } = {},
): Promise<DuplicateGroups> {
  const [summaries, dismissals] = await Promise.all([
    loadSummaries(db, "active"),
    db
      .select({
        lowCustomerId: customerMergeDismissals.lowCustomerId,
        highCustomerId: customerMergeDismissals.highCustomerId,
        dismissedBy: customerMergeDismissals.dismissedBy,
        dismissedAt: customerMergeDismissals.dismissedAt,
        dismissedByName: users.name,
        dismissedByEmail: users.email,
      })
      .from(customerMergeDismissals)
      .leftJoin(users, eq(users.id, customerMergeDismissals.dismissedBy)),
  ]);

  const dismissedByPair = new Map(
    dismissals.map((row) => [pairKey(row.lowCustomerId, row.highCustomerId), row]),
  );
  const excludedPairs = options.includeDismissed
    ? new Set<string>()
    : new Set(dismissedByPair.keys());

  const emailSignals = new Map<number, Signal[]>();
  const looseSignals = new Map<number, Signal[]>();
  for (const customer of summaries.values()) {
    emailSignals.set(
      customer.id,
      customer.emails.map((value) => ({ kind: "email" as const, value })),
    );
    const loose: Signal[] = [];
    const company = normalizeCompanyName(customer.companyName);
    if (company) loose.push({ kind: "company", value: company });
    const phone = normalizePhoneDigits(customer.phone);
    if (phone) loose.push({ kind: "phone", value: phone });
    const name = normalizeContactName(customer.contactName);
    if (name) loose.push({ kind: "name", value: name });
    looseSignals.set(customer.id, loose);
  }

  const toGroup = (found: {
    customerIds: number[];
    reasons: DuplicateReason[];
  }): DuplicateGroup => {
    const members = new Set(found.customerIds);
    return {
      customers: found.customerIds.map((id) => summaries.get(id)!),
      reasons: found.reasons,
      dismissedPairs: (options.includeDismissed ? dismissals : [])
        .filter(
          (row) => members.has(row.lowCustomerId) && members.has(row.highCustomerId),
        )
        .map((row) => ({
          lowCustomerId: row.lowCustomerId,
          highCustomerId: row.highCustomerId,
          dismissedBy: row.dismissedBy,
          dismissedByLabel: row.dismissedByName || row.dismissedByEmail,
          dismissedAt: row.dismissedAt,
        })),
    };
  };

  const sameEmailFound = groupBySharedSignals(emailSignals, excludedPairs);
  const possibleFound = groupBySharedSignals(looseSignals, excludedPairs).filter(
    (candidate) =>
      // Already shown with higher confidence in the "Same email" tier.
      !sameEmailFound.some((sameEmail) =>
        candidate.customerIds.every((id) => sameEmail.customerIds.includes(id)),
      ),
  );

  const mostRecentFirst = (a: DuplicateGroup, b: DuplicateGroup) => {
    const latest = (group: DuplicateGroup) =>
      Math.max(
        0,
        ...group.customers.map((customer) => customer.lastActivityAt?.getTime() ?? 0),
      );
    return (
      latest(b) - latest(a) || a.customers[0].id - b.customers[0].id
    );
  };

  return {
    sameEmail: sameEmailFound.map(toGroup).sort(mostRecentFirst),
    possible: possibleFound.map(toGroup).sort(mostRecentFirst),
  };
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

// ---------------------------------------------------------------------------
// Dismissals
// ---------------------------------------------------------------------------

/** Mark every pair among `customerIds` as "not duplicates". Idempotent. */
export async function dismissCustomerGroup(
  customerIds: number[],
  actor: MergeActor,
): Promise<void> {
  requireElevated(actor);
  const ids = [...new Set(customerIds)].sort((a, b) => a - b);
  const pairs: Array<{ lowCustomerId: number; highCustomerId: number }> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs.push({ lowCustomerId: ids[i], highCustomerId: ids[j] });
    }
  }
  if (pairs.length === 0) return;
  await db
    .insert(customerMergeDismissals)
    .values(pairs.map((pair) => ({ ...pair, dismissedBy: actor.userId })))
    .onConflictDoNothing();
  await resolveSatisfiedCustomerMatchReviews(db, { resolvedBy: actor.userId });
}

/** Forget a "not duplicates" decision so the pair can be suggested again. */
export async function undismissPair(
  customerIdA: number,
  customerIdB: number,
  actor: MergeActor,
): Promise<void> {
  requireElevated(actor);
  await db
    .delete(customerMergeDismissals)
    .where(
      and(
        eq(customerMergeDismissals.lowCustomerId, Math.min(customerIdA, customerIdB)),
        eq(customerMergeDismissals.highCustomerId, Math.max(customerIdA, customerIdB)),
      ),
    );
}