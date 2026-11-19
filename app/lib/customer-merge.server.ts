/**
 * Merging (ADR-0013, carrying over ADR-0012's merge-by-archive).
 *
 * Interface:
 * - {@link findDuplicatePairs} / {@link pairsAmong}: ranked suggestions of
 *   Organizations that look alike. Nothing is stored; nothing merges itself.
 * - {@link previewMerge} / {@link mergeOrganizations}: fold one Organization
 *   into another (two people at one company, an individual joining a business).
 * - {@link previewContactMerge} / {@link mergeContacts}: the same person twice.
 *
 * Merging is gated by `authorize()` (`organization.merge`, `contact.merge`).
 */
import { and, eq, inArray, max, sql } from "drizzle-orm";

import { authorize, type Action, type Actor } from "./authorization/authorize";
import {
  resolveSatisfiedCustomerMatchReviews,
  type DbExecutor,
} from "./customer-match-review.server";
import { CustomerMergeError } from "./customer-merge-error";
import {
  compareContacts,
  compareOrganizations,
  planContactMerge,
  planOrganizationMerge,
  type ContactMergeChoices,
  type ContactMergeState,
  type FieldAutoFill,
  type FieldConflict,
  type OrganizationMergeChoices,
  type OrganizationMergeState,
} from "./customer-merge-fields";
import type {
  AccountMoveView,
  DuplicateReasonKind,
  MergeScope,
  OrganizationSummaryView,
} from "./customer-merge-view";
import {
  normalizeCompanyName,
  normalizeContactName,
  normalizePhoneDigits,
} from "./customer-normalize";
import { db } from "./db";
import {
  accounts,
  actionItems,
  addresses,
  contactEmailAliases,
  contacts,
  eventLogs,
  notes,
  orders,
  organizationAttachments,
  organizationCommunications,
  organizationContacts,
  organizations,
  parts,
  quotes,
  type AccountType,
} from "./db/schema";
import { normalizeEmail } from "./email-normalize";
import { createEvent } from "./events";
import {
  accountIdForLegacyId,
  resolveFinalAccountId,
  type Executor,
} from "./organizations/accounts.server";
import { isFreeEmailDomain } from "./organizations/free-email-domains";
import { emailDomain } from "./organizations/profile";
import { contactDisplayName, isUuid } from "./organizations/types";

export type MergeActor = Actor;

function requireAllowed(actor: MergeActor, action: Action) {
  if (!authorize(actor, action).allowed) {
    throw new CustomerMergeError("Admin or Dev role required", 403);
  }
}

const actorUserId = (actor: MergeActor) => actor.userId;
const actorEmail = (actor: MergeActor) => (actor.kind === "staff" ? actor.email : undefined);

// ---------------------------------------------------------------------------
// Summaries and suggestions
// ---------------------------------------------------------------------------

export type { DuplicateReasonKind };
export type DuplicateReason = { kind: DuplicateReasonKind; value: string };

export type OrganizationSummary = Omit<OrganizationSummaryView, "lastActivityAt"> & {
  lastActivityAt: Date | null;
  createdAt: Date;
  /** Every phone on the Organization and its Contacts, as digits. */
  phones: string[];
  /** Every Contact name, normalized. */
  contactNames: string[];
};

/** @deprecated use OrganizationSummary */
export type CustomerSummary = OrganizationSummary;

export type DuplicatePair = {
  a: OrganizationSummary;
  b: OrganizationSummary;
  reasons: DuplicateReason[];
  /** Higher is more likely to need a merge. See `SIGNAL_WEIGHTS`. */
  score: number;
};

export type DuplicateSuggestions = {
  pairs: DuplicatePair[];
  total: number;
  kindCounts: Record<DuplicateReasonKind, number>;
};

/**
 * How strongly each kind of match suggests a merge. Kinds add up. A shared
 * business domain is the strongest hint that two Customers are two people at
 * one company; it still only suggests.
 */
const SIGNAL_WEIGHTS: Record<DuplicateReasonKind, number> = {
  email: 100,
  domain: 50,
  phone: 45,
  company: 35,
  name: 30,
};

/** A value shared by more Organizations than this is too generic to mean anything. */
const MAX_LOOSE_SIGNAL_GROUP = 25;

const signalKey = (signal: DuplicateReason) => `${signal.kind}\u0000${signal.value}`;

function signalsOf(summary: OrganizationSummary): DuplicateReason[] {
  const signals = new Map<string, DuplicateReason>();
  const add = (kind: DuplicateReasonKind, value: string | null) => {
    if (!value) return;
    const signal = { kind, value };
    signals.set(signalKey(signal), signal);
  };
  for (const email of summary.emails) {
    add("email", email);
    const domain = emailDomain(email);
    if (domain && !isFreeEmailDomain(domain)) add("domain", domain);
  }
  if (summary.kind === "business") add("company", normalizeCompanyName(summary.displayName));
  for (const phone of summary.phones) add("phone", phone);
  for (const name of summary.contactNames) add("name", name);
  return [...signals.values()];
}

const sortReasons = (reasons: DuplicateReason[]) =>
  [...reasons].sort((x, y) => x.kind.localeCompare(y.kind) || x.value.localeCompare(y.value));

function scoreOf(reasons: DuplicateReason[]): number {
  return [...new Set(reasons.map((reason) => reason.kind))].reduce(
    (total, kind) => total + SIGNAL_WEIGHTS[kind],
    0,
  );
}

function sharedSignals(a: OrganizationSummary, b: OrganizationSummary): DuplicateReason[] {
  const inB = new Set(signalsOf(b).map(signalKey));
  return sortReasons(signalsOf(a).filter((signal) => inB.has(signalKey(signal))));
}

const latestActivity = (pair: DuplicatePair) =>
  Math.max(0, pair.a.lastActivityAt?.getTime() ?? 0, pair.b.lastActivityAt?.getTime() ?? 0);

const bestMatchFirst = (x: DuplicatePair, y: DuplicatePair) =>
  y.score - x.score ||
  latestActivity(y) - latestActivity(x) ||
  x.a.id.localeCompare(y.a.id) ||
  x.b.id.localeCompare(y.b.id);

const orderedPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

type SummaryScope = { ids: string[] } | { active: MergeScope };

async function loadSummaries(
  executor: Executor,
  scope: SummaryScope,
): Promise<Map<string, OrganizationSummary>> {
  let orgRows: Array<typeof organizations.$inferSelect>;
  if ("ids" in scope) {
    const ids = scope.ids.filter(isUuid);
    if (ids.length === 0) return new Map();
    orgRows = await executor.select().from(organizations).where(inArray(organizations.id, ids));
  } else {
    const typeFilter =
      scope.active === "all"
        ? sql`true`
        : sql`${accounts.type} = ${scope.active === "customers" ? "customer" : "vendor"}`;
    orgRows = await executor
      .select()
      .from(organizations)
      .where(
        and(
          eq(organizations.isArchived, false),
          sql`exists (select 1 from ${accounts} where ${accounts.organizationId} = ${organizations.id}
                and ${accounts.isArchived} = false and ${typeFilter})`,
        ),
      );
  }
  if (orgRows.length === 0) return new Map();
  const orgIds = orgRows.map((org) => org.id);

  const [accountRows, contactRows] = await Promise.all([
    executor
      .select({ id: accounts.id, organizationId: accounts.organizationId, type: accounts.type, isArchived: accounts.isArchived })
      .from(accounts)
      .where(inArray(accounts.organizationId, orgIds)),
    executor
      .select({
        organizationId: organizationContacts.organizationId,
        isPrimary: organizationContacts.isPrimary,
        contact: contacts,
      })
      .from(organizationContacts)
      .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
      .where(
        and(
          inArray(organizationContacts.organizationId, orgIds),
          eq(organizationContacts.isArchived, false),
          eq(contacts.isArchived, false),
        ),
      ),
  ]);
  const contactIds = [...new Set(contactRows.map((row) => row.contact.id))];
  const customerAccountIds = accountRows.filter((row) => row.type === "customer").map((row) => row.id);
  const [aliasRows, quoteStats, orderStats] = await Promise.all([
    contactIds.length === 0
      ? []
      : executor.select().from(contactEmailAliases).where(inArray(contactEmailAliases.contactId, contactIds)),
    customerAccountIds.length === 0
      ? []
      : executor
          .select({ accountId: quotes.customerAccountId, total: sql<number>`count(*)::int`, latest: max(quotes.createdAt) })
          .from(quotes)
          .where(inArray(quotes.customerAccountId, customerAccountIds))
          .groupBy(quotes.customerAccountId),
    customerAccountIds.length === 0
      ? []
      : executor
          .select({ accountId: orders.customerAccountId, total: sql<number>`count(*)::int`, latest: max(orders.createdAt) })
          .from(orders)
          .where(inArray(orders.customerAccountId, customerAccountIds))
          .groupBy(orders.customerAccountId),
  ]);

  const aliasesByContact = new Map<string, string[]>();
  for (const alias of aliasRows) {
    const normalized = normalizeEmail(alias.email);
    if (!normalized) continue;
    aliasesByContact.set(alias.contactId, [...(aliasesByContact.get(alias.contactId) ?? []), normalized]);
  }
  const quoteByAccount = new Map(quoteStats.map((row) => [row.accountId, row]));
  const orderByAccount = new Map(orderStats.map((row) => [row.accountId, row]));

  return new Map(
    orgRows.map((org) => {
      const orgAccounts = accountRows.filter((row) => row.organizationId === org.id);
      const pick = (type: AccountType) =>
        orgAccounts.find((row) => row.type === type && !row.isArchived) ??
        orgAccounts.find((row) => row.type === type) ??
        null;
      const customer = pick("customer");
      const vendor = pick("vendor");
      const orgContacts = contactRows
        .filter((row) => row.organizationId === org.id)
        .sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary));
      const primary = orgContacts.find((row) => row.isPrimary)?.contact ?? orgContacts[0]?.contact ?? null;
      const emails = new Set<string>();
      const phones = new Set<string>();
      const names = new Set<string>();
      for (const { contact } of orgContacts) {
        for (const alias of aliasesByContact.get(contact.id) ?? []) emails.add(alias);
        const primaryEmail = normalizeEmail(contact.email);
        if (primaryEmail) emails.add(primaryEmail);
        const phone = normalizePhoneDigits(contact.phone);
        if (phone) phones.add(phone);
        const name = normalizeContactName(contact.name);
        if (name) names.add(name);
      }
      const orgPhone = normalizePhoneDigits(org.phone);
      if (orgPhone) phones.add(orgPhone);
      const quoteRow = customer ? quoteByAccount.get(customer.id) : undefined;
      const orderRow = customer ? orderByAccount.get(customer.id) : undefined;
      const latest = [quoteRow?.latest, orderRow?.latest]
        .filter((value): value is Date => value instanceof Date)
        .sort((x, y) => y.getTime() - x.getTime())[0];
      const summary: OrganizationSummary = {
        id: org.id,
        kind: org.kind,
        displayName: org.name,
        companyName: org.kind === "business" ? org.name : null,
        customerAccountId: customer?.id ?? null,
        vendorAccountId: vendor?.id ?? null,
        contactName: primary?.name ?? null,
        email: primary?.email ?? null,
        phone: primary?.phone ?? org.phone ?? null,
        contacts: orgContacts.map(({ contact }) => ({ id: contact.id, name: contact.name, email: contact.email })),
        emails: [...emails].sort(),
        phones: [...phones].sort(),
        contactNames: [...names].sort(),
        quoteCount: Number(quoteRow?.total ?? 0),
        orderCount: Number(orderRow?.total ?? 0),
        lastActivityAt: latest ?? null,
        createdAt: org.createdAt,
      };
      return [org.id, summary];
    }),
  );
}

/**
 * Suggest pairs of active Organizations that look like they should be one,
 * best match first. `kinds` narrows to pairs sharing EVERY listed signal;
 * `scope` picks Customers, Vendors or both.
 */
export async function findDuplicatePairs(
  options: { kinds?: DuplicateReasonKind[]; limit?: number; offset?: number; scope?: MergeScope } = {},
): Promise<DuplicateSuggestions> {
  const summaries = await loadSummaries(db, { active: options.scope ?? "customers" });

  const idsBySignal = new Map<string, { signal: DuplicateReason; ids: string[] }>();
  for (const summary of summaries.values()) {
    for (const signal of signalsOf(summary)) {
      const key = signalKey(signal);
      const entry = idsBySignal.get(key) ?? { signal, ids: [] };
      entry.ids.push(summary.id);
      idsBySignal.set(key, entry);
    }
  }

  const reasonsByPair = new Map<string, { lowId: string; highId: string; reasons: DuplicateReason[] }>();
  for (const { signal, ids } of idsBySignal.values()) {
    if (ids.length < 2) continue;
    if (signal.kind !== "email" && ids.length > MAX_LOOSE_SIGNAL_GROUP) continue;
    const sorted = [...ids].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const [lowId, highId] = orderedPair(sorted[i], sorted[j]);
        const key = `${lowId}:${highId}`;
        const entry = reasonsByPair.get(key) ?? { lowId, highId, reasons: [] };
        entry.reasons.push(signal);
        reasonsByPair.set(key, entry);
      }
    }
  }

  const kindCounts: Record<DuplicateReasonKind, number> = { email: 0, domain: 0, phone: 0, company: 0, name: 0 };
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

/** Every pair among `summaries`, with whatever each pair shares (possibly nothing). */
export function pairsAmong(summaries: OrganizationSummary[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < summaries.length; i++) {
    for (let j = i + 1; j < summaries.length; j++) {
      const [a, b] =
        summaries[i].id < summaries[j].id ? [summaries[i], summaries[j]] : [summaries[j], summaries[i]];
      const reasons = sharedSignals(a, b);
      pairs.push({ a, b, reasons, score: scoreOf(reasons) });
    }
  }
  return pairs.sort(bestMatchFirst);
}

/**
 * Summaries of the active Organizations behind customer account ids (uuids,
 * or legacy integer Customer ids from old Action Items). Merged-away accounts
 * resolve to their survivor and duplicates collapse.
 */
export async function getActiveOrganizationSummaries(ids: string[]): Promise<OrganizationSummary[]> {
  const accountIds = await Promise.all(
    ids.map(async (id) => (/^\d+$/.test(id) ? accountIdForLegacyId("customer", Number(id)) : id)),
  );
  const finalAccountIds = (
    await Promise.all(accountIds.map((id) => (id && isUuid(id) ? resolveFinalAccountId(id) : null)))
  ).filter((id): id is string => id !== null);
  if (finalAccountIds.length === 0) return [];
  const orgRows = await db
    .select({ accountId: accounts.id, organizationId: accounts.organizationId })
    .from(accounts)
    .where(inArray(accounts.id, finalAccountIds));
  const orgIds = [...new Set(finalAccountIds.map((id) => orgRows.find((row) => row.accountId === id)!.organizationId))];
  const summaries = await loadSummaries(db, { ids: orgIds });
  return orgIds.flatMap((id) => summaries.get(id) ?? []);
}

/** @deprecated use getActiveOrganizationSummaries */
export const getActiveCustomerSummaries = getActiveOrganizationSummaries;

// ---------------------------------------------------------------------------
// Organization merge
// ---------------------------------------------------------------------------

export type MergeCounts = {
  quotes: number;
  orders: number;
  parts: number;
  vendorQuotes: number;
  vendorOrders: number;
  contacts: number;
  addresses: number;
  attachments: number;
  communications: number;
  notes: number;
  events: number;
};

export type MergePreview = {
  survivor: OrganizationSummary;
  merged: OrganizationSummary;
  counts: MergeCounts;
  contactsAlreadyLinked: number;
  attachmentsAlreadyLinked: number;
  accounts: AccountMoveView[];
  retainedEmails: string[];
  conflicts: FieldConflict[];
  autoFills: FieldAutoFill[];
  survivorUpdatedAt: Date;
  mergedUpdatedAt: Date;
};

export type MergeInput = {
  survivorId: string;
  mergedId: string;
  choices?: OrganizationMergeChoices;
  expected?: { survivorUpdatedAt: Date; mergedUpdatedAt: Date };
};

export type MergeResult = {
  survivorId: string;
  mergedId: string;
  /** Where to send staff afterwards: the survivor's Customer page, else Vendor page. */
  survivorCustomerAccountId: string | null;
  survivorVendorAccountId: string | null;
  counts: MergeCounts;
  attachmentsAlreadyLinked: number;
};

type AccountState = NonNullable<OrganizationMergeState["customer"]> & { isArchived: boolean };

type OrgState = Omit<OrganizationMergeState, "customer" | "vendor"> & {
  customer: AccountState | null;
  vendor: AccountState | null;
  isArchived: boolean;
  mergedInto: string | null;
  /** Latest change on the Organization, its accounts, links, Contacts and addresses. */
  version: Date;
  customerArchived: boolean;
  vendorArchived: boolean;
};

async function loadOrgState(executor: Executor, organizationId: string): Promise<OrgState | null> {
  const [org] = await executor.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return null;
  const [accountRows, primaryRows, shippingRows, versionRows] = await Promise.all([
    executor.select().from(accounts).where(eq(accounts.organizationId, organizationId)),
    executor
      .select({ contact: contacts })
      .from(organizationContacts)
      .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
      .where(
        and(
          eq(organizationContacts.organizationId, organizationId),
          eq(organizationContacts.isPrimary, true),
          eq(organizationContacts.isArchived, false),
        ),
      )
      .limit(1),
    executor
      .select()
      .from(addresses)
      .where(
        and(
          eq(addresses.organizationId, organizationId),
          eq(addresses.isDefaultShipping, true),
          eq(addresses.isArchived, false),
        ),
      )
      .limit(1),
    executor.execute<{ version: string }>(sql`
      select greatest(
        o.updated_at,
        coalesce((select max(updated_at) from accounts where organization_id = o.id), o.updated_at),
        coalesce((select max(updated_at) from addresses where organization_id = o.id), o.updated_at),
        coalesce((select max(oc.updated_at) from organization_contacts oc where oc.organization_id = o.id), o.updated_at),
        coalesce((select max(c.updated_at) from organization_contacts oc join contacts c on c.id = oc.contact_id
                  where oc.organization_id = o.id), o.updated_at)
      )::text as version
      from organizations o where o.id = ${organizationId}
    `),
  ]);
  const billingIds = accountRows.map((row) => row.billingAddressId).filter((id): id is string => Boolean(id));
  const billingRows = billingIds.length
    ? await executor.select().from(addresses).where(inArray(addresses.id, billingIds))
    : [];
  const side = (type: AccountType) => {
    const row = accountRows.find((account) => account.type === type);
    if (!row) return null;
    const billing = billingRows.find((address) => address.id === row.billingAddressId) ?? null;
    return {
      id: row.id,
      isArchived: row.isArchived,
      paymentTerms: row.paymentTerms,
      billingAddressId: row.billingAddressId,
      billingAddress: billing,
      discordId: row.discordId,
      notes: row.notes,
    };
  };
  const customer = side("customer");
  const vendor = side("vendor");
  const primary = primaryRows[0]?.contact ?? null;
  const shipping = shippingRows[0] ?? null;
  const versionText = (versionRows as unknown as Array<{ version: string }>)[0]?.version;
  return {
    id: org.id,
    name: org.name,
    kind: org.kind,
    website: org.website,
    phone: org.phone,
    primaryContact: primary ? { id: primary.id, label: contactDisplayName(primary) } : null,
    defaultShipping: shipping ? { id: shipping.id, address: shipping } : null,
    customer,
    vendor,
    customerArchived: customer?.isArchived ?? false,
    vendorArchived: vendor?.isArchived ?? false,
    isArchived: org.isArchived,
    mergedInto: org.mergedIntoOrganizationId,
    version: versionText ? new Date(versionText.replace(" ", "T") + "Z") : org.updatedAt,
  };
}

function assertMergeable(survivor: OrgState | null, merged: OrgState | null) {
  if (!survivor || !merged) throw new CustomerMergeError("Organization not found", 404);
  if (merged.isArchived && merged.mergedInto !== null) {
    throw new CustomerMergeError("That Organization was already merged into another one", 409);
  }
  if (survivor.isArchived || merged.isArchived) {
    throw new CustomerMergeError("Archived Organizations cannot be merged", 409);
  }
}

function accountPlan(survivor: OrgState, merged: OrgState): AccountMoveView[] {
  return (["customer", "vendor"] as const).map((type) => {
    const mergedSide = merged[type];
    const survivorSide = survivor[type];
    return {
      type,
      mode: !mergedSide ? "none" : survivorSide ? "fold" : "move",
    } satisfies AccountMoveView;
  });
}

async function countMovable(executor: Executor, survivor: OrgState, merged: OrgState) {
  const mergedCustomer = merged.customer?.id ?? null;
  const mergedVendor = merged.vendor?.id ?? null;
  const accountIds = [mergedCustomer, mergedVendor].filter((id): id is string => Boolean(id));
  const idList = accountIds.length ? sql.join(accountIds.map((id) => sql`${id}`), sql`, `) : sql`null`;
  const [row] = (await executor.execute(sql`
    select
      (select count(*)::int from quotes where customer_account_id = ${mergedCustomer}) as quotes,
      (select count(*)::int from orders where customer_account_id = ${mergedCustomer}) as orders,
      (select count(*)::int from parts where customer_account_id = ${mergedCustomer}) as parts,
      (select count(*)::int from quotes where vendor_account_id = ${mergedVendor}) as vendor_quotes,
      (select count(*)::int from orders where vendor_account_id = ${mergedVendor}) as vendor_orders,
      (select count(*)::int from organization_contacts m
        where m.organization_id = ${merged.id} and not m.is_archived
          and not exists (select 1 from organization_contacts s
            where s.organization_id = ${survivor.id} and s.contact_id = m.contact_id and not s.is_archived)) as contacts,
      (select count(*)::int from organization_contacts m
        where m.organization_id = ${merged.id} and not m.is_archived
          and exists (select 1 from organization_contacts s
            where s.organization_id = ${survivor.id} and s.contact_id = m.contact_id and not s.is_archived)) as contacts_already_linked,
      (select count(*)::int from addresses where organization_id = ${merged.id} and not is_archived) as addresses,
      (select count(*)::int from organization_attachments m
        where m.organization_id = ${merged.id}
          and not exists (select 1 from organization_attachments s
            where s.organization_id = ${survivor.id} and s.attachment_id = m.attachment_id)) as attachments,
      (select count(*)::int from organization_attachments m
        where m.organization_id = ${merged.id}
          and exists (select 1 from organization_attachments s
            where s.organization_id = ${survivor.id} and s.attachment_id = m.attachment_id)) as attachments_already_linked,
      (select count(*)::int from organization_communications where organization_id = ${merged.id}) as communications,
      (select count(*)::int from notes where entity_type in ('customer', 'vendor') and entity_id in (${idList})) as notes,
      (select count(*)::int from event_logs where entity_type in ('customer', 'vendor') and entity_id in (${idList})) as events
  `)) as unknown as Array<Record<string, number>>;
  return {
    counts: {
      quotes: row.quotes,
      orders: row.orders,
      parts: row.parts,
      vendorQuotes: row.vendor_quotes,
      vendorOrders: row.vendor_orders,
      contacts: row.contacts,
      addresses: row.addresses,
      attachments: row.attachments,
      communications: row.communications,
      notes: row.notes,
      events: row.events,
    } satisfies MergeCounts,
    contactsAlreadyLinked: row.contacts_already_linked,
    attachmentsAlreadyLinked: row.attachments_already_linked,
  };
}

/** What merging `mergedId` into `survivorId` would do. Changes nothing. */
export async function previewMerge(input: { survivorId: string; mergedId: string }): Promise<MergePreview> {
  if (input.survivorId === input.mergedId) {
    throw new CustomerMergeError("An Organization cannot be merged into itself", 400);
  }
  if (!isUuid(input.survivorId) || !isUuid(input.mergedId)) {
    throw new CustomerMergeError("Organization not found", 404);
  }
  const [survivor, merged] = await Promise.all([
    loadOrgState(db, input.survivorId),
    loadOrgState(db, input.mergedId),
  ]);
  assertMergeable(survivor, merged);
  const [summaries, moved] = await Promise.all([
    loadSummaries(db, { ids: [input.survivorId, input.mergedId] }),
    countMovable(db, survivor!, merged!),
  ]);
  const survivorSummary = summaries.get(input.survivorId)!;
  const mergedSummary = summaries.get(input.mergedId)!;
  const { conflicts, autoFills } = compareOrganizations(survivor!, merged!);
  return {
    survivor: survivorSummary,
    merged: mergedSummary,
    counts: moved.counts,
    contactsAlreadyLinked: moved.contactsAlreadyLinked,
    attachmentsAlreadyLinked: moved.attachmentsAlreadyLinked,
    accounts: accountPlan(survivor!, merged!),
    retainedEmails: [...new Set([...survivorSummary.emails, ...mergedSummary.emails])].sort(),
    conflicts,
    autoFills,
    survivorUpdatedAt: survivor!.version,
    mergedUpdatedAt: merged!.version,
  };
}

/** Move one account type of `merged` onto `survivor`, folding or re-parenting. */
async function moveAccount(
  tx: Executor,
  type: AccountType,
  survivor: OrgState,
  merged: OrgState,
  plan: ReturnType<typeof planOrganizationMerge>,
  now: Date,
) {
  const from = merged[type];
  if (!from) return { quotes: [] as number[], orders: [] as number[], parts: [] as string[], notes: [] as string[], events: [] as string[], mode: "none" as const };
  const into = survivor[type];

  if (!into) {
    // B has no account of this type: A's account becomes B's, id and history intact.
    await tx
      .update(accounts)
      .set({ organizationId: survivor.id, updatedAt: now })
      .where(eq(accounts.id, from.id));
    return { quotes: [], orders: [], parts: [], notes: [], events: [], mode: "move" as const };
  }

  const movedQuotes =
    type === "customer"
      ? await tx.update(quotes).set({ customerAccountId: into.id }).where(eq(quotes.customerAccountId, from.id)).returning({ id: quotes.id })
      : await tx.update(quotes).set({ vendorAccountId: into.id }).where(eq(quotes.vendorAccountId, from.id)).returning({ id: quotes.id });
  const movedOrders =
    type === "customer"
      ? await tx.update(orders).set({ customerAccountId: into.id }).where(eq(orders.customerAccountId, from.id)).returning({ id: orders.id })
      : await tx.update(orders).set({ vendorAccountId: into.id }).where(eq(orders.vendorAccountId, from.id)).returning({ id: orders.id });
  const movedParts =
    type === "customer"
      ? await tx.update(parts).set({ customerAccountId: into.id }).where(eq(parts.customerAccountId, from.id)).returning({ id: parts.id })
      : [];
  const movedNotes = await tx
    .update(notes)
    .set({ entityId: into.id })
    .where(and(eq(notes.entityType, type), eq(notes.entityId, from.id)))
    .returning({ id: notes.id });
  const movedEvents = await tx
    .update(eventLogs)
    .set({ entityId: into.id })
    .where(and(eq(eventLogs.entityType, type), eq(eventLogs.entityId, from.id)))
    .returning({ id: eventLogs.id });
  await tx
    .update(actionItems)
    .set({ entityId: into.id, updatedAt: now })
    .where(and(eq(actionItems.entityType, type), eq(actionItems.entityId, from.id)));

  const fields = type === "customer" ? plan.customer : plan.vendor;
  const intoUpdates: Partial<typeof accounts.$inferInsert> = { updatedAt: now };
  if (fields) Object.assign(intoUpdates, fields);
  // An archived survivor account takes over when the merged one was active.
  if (into.isArchived && !from.isArchived) intoUpdates.isArchived = false;
  await tx.update(accounts).set(intoUpdates).where(eq(accounts.id, into.id));
  await tx
    .update(accounts)
    .set({ isArchived: true, billingAddressId: null, updatedAt: now })
    .where(eq(accounts.id, from.id));

  return {
    quotes: movedQuotes.map((row) => row.id),
    orders: movedOrders.map((row) => row.id),
    parts: movedParts.map((row) => row.id),
    notes: movedNotes.map((row) => row.id),
    events: movedEvents.map((row) => row.id),
    mode: "fold" as const,
  };
}

/**
 * Fold Organization `mergedId` into `survivorId` in one transaction: Contacts
 * join (links the survivor already has collapse), addresses move, each account
 * folds into the survivor's or becomes the survivor's, files, communications,
 * Notes and Event logs move, and the merged Organization is archived with a
 * pointer to the survivor.
 */
export async function mergeOrganizations(input: MergeInput, actor: MergeActor): Promise<MergeResult> {
  requireAllowed(actor, "organization.merge");
  const { survivorId, mergedId } = input;
  if (survivorId === mergedId) {
    throw new CustomerMergeError("An Organization cannot be merged into itself", 400);
  }
  if (!isUuid(survivorId) || !isUuid(mergedId)) throw new CustomerMergeError("Organization not found", 404);

  return db.transaction(async (tx) => {
    // Lock in id order so concurrent merges of the same pair cannot deadlock.
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(inArray(organizations.id, [survivorId, mergedId]))
      .orderBy(organizations.id)
      .for("update");
    const survivor = await loadOrgState(tx, survivorId);
    const merged = await loadOrgState(tx, mergedId);
    assertMergeable(survivor, merged);
    if (
      input.expected &&
      (survivor!.version.getTime() !== input.expected.survivorUpdatedAt.getTime() ||
        merged!.version.getTime() !== input.expected.mergedUpdatedAt.getTime())
    ) {
      throw new CustomerMergeError(
        "An Organization changed while you were reviewing. Reload and review again.",
        409,
      );
    }
    const plan = planOrganizationMerge(survivor!, merged!, input.choices ?? {});
    const now = new Date();

    // Contacts: move each link, or collapse it into the survivor's existing link.
    const mergedLinks = await tx
      .select()
      .from(organizationContacts)
      .where(and(eq(organizationContacts.organizationId, mergedId), eq(organizationContacts.isArchived, false)));
    const survivorLinks = await tx
      .select()
      .from(organizationContacts)
      .where(eq(organizationContacts.organizationId, survivorId));
    const movedContactIds: string[] = [];
    let collapsed = 0;
    for (const link of mergedLinks) {
      const existing = survivorLinks.find((row) => row.contactId === link.contactId);
      if (existing) {
        collapsed += 1;
        await tx
          .update(organizationContacts)
          .set({ isArchived: false, role: existing.role ?? link.role, updatedAt: now })
          .where(eq(organizationContacts.id, existing.id));
        await tx
          .update(organizationContacts)
          .set({ isArchived: true, isPrimary: false, updatedAt: now })
          .where(eq(organizationContacts.id, link.id));
      } else {
        movedContactIds.push(link.contactId);
        await tx
          .update(organizationContacts)
          .set({ organizationId: survivorId, isPrimary: false, updatedAt: now })
          .where(eq(organizationContacts.id, link.id));
      }
    }
    // Archived links of the merged Organization stay with it as history.
    if (plan.primaryContactId) {
      await tx
        .update(organizationContacts)
        .set({ isPrimary: false, updatedAt: now })
        .where(and(eq(organizationContacts.organizationId, survivorId), eq(organizationContacts.isPrimary, true)));
      await tx
        .update(organizationContacts)
        .set({ isPrimary: true, isArchived: false, updatedAt: now })
        .where(
          and(
            eq(organizationContacts.organizationId, survivorId),
            eq(organizationContacts.contactId, plan.primaryContactId),
          ),
        );
    }

    // Addresses move; only one default shipping address survives.
    if (survivor!.defaultShipping && merged!.defaultShipping) {
      const loserId = plan.defaultShippingAddressId === merged!.defaultShipping.id
        ? survivor!.defaultShipping.id
        : merged!.defaultShipping.id;
      await tx.update(addresses).set({ isDefaultShipping: false, updatedAt: now }).where(eq(addresses.id, loserId));
    }
    const movedAddresses = await tx
      .update(addresses)
      .set({ organizationId: survivorId, updatedAt: now })
      .where(eq(addresses.organizationId, mergedId))
      .returning({ id: addresses.id });

    const customerMove = await moveAccount(tx, "customer", survivor!, merged!, plan, now);
    const vendorMove = await moveAccount(tx, "vendor", survivor!, merged!, plan, now);

    // Files: the link key is (Organization, Attachment), so shared files link once.
    const alreadyLinked = await tx
      .delete(organizationAttachments)
      .where(
        and(
          eq(organizationAttachments.organizationId, mergedId),
          inArray(
            organizationAttachments.attachmentId,
            tx
              .select({ id: organizationAttachments.attachmentId })
              .from(organizationAttachments)
              .where(eq(organizationAttachments.organizationId, survivorId)),
          ),
        ),
      )
      .returning({ attachmentId: organizationAttachments.attachmentId });
    const movedAttachments = await tx
      .update(organizationAttachments)
      .set({ organizationId: survivorId })
      .where(eq(organizationAttachments.organizationId, mergedId))
      .returning({ attachmentId: organizationAttachments.attachmentId });
    const movedCommunications = await tx
      .update(organizationCommunications)
      .set({ organizationId: survivorId })
      .where(eq(organizationCommunications.organizationId, mergedId))
      .returning({ id: organizationCommunications.id });

    await tx
      .update(organizations)
      .set({ ...plan.organization, updatedAt: now })
      .where(eq(organizations.id, survivorId));
    await tx
      .update(organizations)
      .set({ isArchived: true, mergedIntoOrganizationId: survivorId, updatedAt: now })
      .where(eq(organizations.id, mergedId));

    const counts: MergeCounts = {
      quotes: customerMove.quotes.length,
      orders: customerMove.orders.length,
      parts: customerMove.parts.length,
      vendorQuotes: vendorMove.quotes.length,
      vendorOrders: vendorMove.orders.length,
      contacts: movedContactIds.length,
      addresses: movedAddresses.length,
      attachments: movedAttachments.length,
      communications: movedCommunications.length,
      notes: customerMove.notes.length + vendorMove.notes.length,
      events: customerMove.events.length + vendorMove.events.length,
    };

    const survivorCustomerAccountId = survivor!.customer?.id ?? merged!.customer?.id ?? null;
    const survivorVendorAccountId = survivor!.vendor?.id ?? merged!.vendor?.id ?? null;
    const eventEntity = survivorCustomerAccountId
      ? { entityType: "customer", entityId: survivorCustomerAccountId }
      : { entityType: "vendor", entityId: survivorVendorAccountId! };
    await createEvent(
      {
        ...eventEntity,
        eventType: "organizations_merged",
        eventCategory: "system",
        title: `Merged "${merged!.name}" into "${survivor!.name}"`,
        description: `Organization ${merged!.name} was merged into ${survivor!.name} and archived.`,
        metadata: {
          survivorOrganizationId: survivorId,
          mergedOrganizationId: mergedId,
          accounts: {
            customer: customerMove.mode,
            vendor: vendorMove.mode,
            mergedCustomerAccountId: merged!.customer?.id ?? null,
            mergedVendorAccountId: merged!.vendor?.id ?? null,
          },
          counts,
          contactsAlreadyLinked: collapsed,
          attachmentsAlreadyLinked: alreadyLinked.length,
          choices: input.choices ?? {},
          moved: {
            quotes: customerMove.quotes,
            orders: customerMove.orders,
            parts: customerMove.parts,
            vendorQuotes: vendorMove.quotes,
            vendorOrders: vendorMove.orders,
            contacts: movedContactIds,
            addresses: movedAddresses.map((row) => row.id),
            communications: movedCommunications.map((row) => row.id),
            notes: [...customerMove.notes, ...vendorMove.notes],
            attachments: movedAttachments.map((row) => row.attachmentId),
          },
        },
        userId: actorUserId(actor),
        userEmail: actorEmail(actor),
      },
      tx,
    );

    await resolveSatisfiedCustomerMatchReviews(tx, { resolvedBy: actorUserId(actor), now });

    return {
      survivorId,
      mergedId,
      survivorCustomerAccountId,
      survivorVendorAccountId,
      counts,
      attachmentsAlreadyLinked: alreadyLinked.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Contact merge
// ---------------------------------------------------------------------------

export type ContactMergePreview = {
  survivor: ContactMergeState & { emails: string[]; organizations: Array<{ id: string; name: string }> };
  merged: ContactMergeState & { emails: string[]; organizations: Array<{ id: string; name: string }> };
  retainedEmails: string[];
  /** Organizations the survivor joins through the merge. */
  joinsOrganizations: Array<{ id: string; name: string }>;
  communications: number;
  conflicts: FieldConflict[];
  autoFills: FieldAutoFill[];
  survivorUpdatedAt: Date;
  mergedUpdatedAt: Date;
};

async function loadContactState(executor: Executor, contactId: string) {
  if (!isUuid(contactId)) return null;
  const [contact] = await executor.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact) return null;
  const [aliases, orgs] = await Promise.all([
    executor.select().from(contactEmailAliases).where(eq(contactEmailAliases.contactId, contactId)),
    executor
      .select({ id: organizations.id, name: organizations.name, linkUpdatedAt: organizationContacts.updatedAt })
      .from(organizationContacts)
      .innerJoin(organizations, eq(organizations.id, organizationContacts.organizationId))
      .where(and(eq(organizationContacts.contactId, contactId), eq(organizationContacts.isArchived, false))),
  ]);
  const emails = new Set(aliases.map((alias) => alias.email));
  const primary = normalizeEmail(contact.email);
  if (primary) emails.add(primary);
  const version = new Date(
    Math.max(contact.updatedAt.getTime(), ...orgs.map((org) => org.linkUpdatedAt.getTime())),
  );
  return {
    row: contact,
    state: {
      id: contact.id,
      name: contact.name,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      emails: [...emails].sort(),
      organizations: orgs.map(({ id, name }) => ({ id, name })),
    },
    version,
  };
}

function assertContactsMergeable(
  survivor: Awaited<ReturnType<typeof loadContactState>>,
  merged: Awaited<ReturnType<typeof loadContactState>>,
) {
  if (!survivor || !merged) throw new CustomerMergeError("Contact not found", 404);
  if (merged.row.mergedIntoContactId) {
    throw new CustomerMergeError("That Contact was already merged into another one", 409);
  }
  if (survivor.row.isArchived || merged.row.isArchived) {
    throw new CustomerMergeError("Archived Contacts cannot be merged", 409);
  }
}

export async function previewContactMerge(input: {
  survivorId: string;
  mergedId: string;
}): Promise<ContactMergePreview> {
  if (input.survivorId === input.mergedId) {
    throw new CustomerMergeError("A Contact cannot be merged into itself", 400);
  }
  const [survivor, merged] = await Promise.all([
    loadContactState(db, input.survivorId),
    loadContactState(db, input.mergedId),
  ]);
  assertContactsMergeable(survivor, merged);
  const [{ count }] = (await db.execute(sql`
    select count(*)::int as count from organization_communications where contact_id = ${input.mergedId}
  `)) as unknown as Array<{ count: number }>;
  const { conflicts, autoFills } = compareContacts(survivor!.state, merged!.state);
  const survivorOrgIds = new Set(survivor!.state.organizations.map((org) => org.id));
  return {
    survivor: survivor!.state,
    merged: merged!.state,
    retainedEmails: [...new Set([...survivor!.state.emails, ...merged!.state.emails])].sort(),
    joinsOrganizations: merged!.state.organizations.filter((org) => !survivorOrgIds.has(org.id)),
    communications: count,
    conflicts,
    autoFills,
    survivorUpdatedAt: survivor!.version,
    mergedUpdatedAt: merged!.version,
  };
}

export type ContactMergeInput = {
  survivorId: string;
  mergedId: string;
  choices?: ContactMergeChoices;
  expected?: { survivorUpdatedAt: Date; mergedUpdatedAt: Date };
};

/**
 * Merge Contact `mergedId` into `survivorId`: its emails become aliases of the
 * survivor, its Organization links combine with the survivor's (primary status
 * carries over), its logged communications point at the survivor, and it is
 * archived with `merged_into_contact_id`.
 */
export async function mergeContacts(input: ContactMergeInput, actor: MergeActor) {
  requireAllowed(actor, "contact.merge");
  const { survivorId, mergedId } = input;
  if (survivorId === mergedId) throw new CustomerMergeError("A Contact cannot be merged into itself", 400);

  return db.transaction(async (tx) => {
    await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(inArray(contacts.id, [survivorId, mergedId].filter(isUuid)))
      .orderBy(contacts.id)
      .for("update");
    const survivor = await loadContactState(tx, survivorId);
    const merged = await loadContactState(tx, mergedId);
    assertContactsMergeable(survivor, merged);
    if (
      input.expected &&
      (survivor!.version.getTime() !== input.expected.survivorUpdatedAt.getTime() ||
        merged!.version.getTime() !== input.expected.mergedUpdatedAt.getTime())
    ) {
      throw new CustomerMergeError("A Contact changed while you were reviewing. Reload and review again.", 409);
    }
    const updates = planContactMerge(survivor!.state, merged!.state, input.choices ?? {});
    const now = new Date();

    const retained = new Set<string>(merged!.state.emails);
    for (const email of [survivor!.row.email, updates.email]) {
      const normalized = normalizeEmail(email);
      if (normalized) retained.add(normalized);
    }
    if (retained.size > 0) {
      await tx
        .insert(contactEmailAliases)
        .values([...retained].map((email) => ({ contactId: survivorId, email })))
        .onConflictDoNothing();
    }
    await tx.delete(contactEmailAliases).where(eq(contactEmailAliases.contactId, mergedId));

    const mergedLinks = await tx
      .select()
      .from(organizationContacts)
      .where(and(eq(organizationContacts.contactId, mergedId), eq(organizationContacts.isArchived, false)));
    const survivorLinks = await tx
      .select()
      .from(organizationContacts)
      .where(eq(organizationContacts.contactId, survivorId));
    const joined: string[] = [];
    for (const link of mergedLinks) {
      const existing = survivorLinks.find((row) => row.organizationId === link.organizationId);
      if (existing) {
        await tx
          .update(organizationContacts)
          .set({ isArchived: true, isPrimary: false, updatedAt: now })
          .where(eq(organizationContacts.id, link.id));
        await tx
          .update(organizationContacts)
          .set({
            isArchived: false,
            isPrimary: existing.isPrimary || link.isPrimary,
            role: existing.role ?? link.role,
            updatedAt: now,
          })
          .where(eq(organizationContacts.id, existing.id));
      } else {
        joined.push(link.organizationId);
        await tx
          .update(organizationContacts)
          .set({ contactId: survivorId, updatedAt: now })
          .where(eq(organizationContacts.id, link.id));
      }
    }
    const movedCommunications = await tx
      .update(organizationCommunications)
      .set({ contactId: survivorId })
      .where(eq(organizationCommunications.contactId, mergedId))
      .returning({ id: organizationCommunications.id });

    await tx.update(contacts).set({ ...updates, updatedAt: now }).where(eq(contacts.id, survivorId));
    await tx
      .update(contacts)
      .set({ isArchived: true, mergedIntoContactId: survivorId, updatedAt: now })
      .where(eq(contacts.id, mergedId));

    // Log on every account of every Organization the survivor belongs to now.
    const orgIds = [...new Set([...survivor!.state.organizations.map((org) => org.id), ...joined])];
    const accountRows = orgIds.length
      ? await tx
          .select({ id: accounts.id, type: accounts.type })
          .from(accounts)
          .where(and(inArray(accounts.organizationId, orgIds), eq(accounts.isArchived, false)))
      : [];
    for (const account of accountRows) {
      await createEvent(
        {
          entityType: account.type,
          entityId: account.id,
          eventType: "contacts_merged",
          eventCategory: "system",
          title: `Merged Contact "${contactDisplayName(merged!.row)}" into "${contactDisplayName(survivor!.row)}"`,
          metadata: {
            survivorContactId: survivorId,
            mergedContactId: mergedId,
            choices: input.choices ?? {},
            retainedEmails: [...retained].sort(),
            joinedOrganizationIds: joined,
            communications: movedCommunications.map((row) => row.id),
          },
          userId: actorUserId(actor),
          userEmail: actorEmail(actor),
        },
        tx,
      );
    }

    return { survivorId, mergedId, joinedOrganizationIds: joined };
  });
}

/**
 * Pairs of active Contacts on one Organization that look like the same person
 * (same email, or same name). Shown on the Customer and Vendor pages.
 */
export async function findDuplicateContacts(
  organizationId: string,
  executor: DbExecutor = db,
): Promise<Array<{ a: string; b: string; reason: "email" | "name" }>> {
  const rows = await executor
    .select({ id: contacts.id, name: contacts.name, email: contacts.email })
    .from(organizationContacts)
    .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
    .where(
      and(
        eq(organizationContacts.organizationId, organizationId),
        eq(organizationContacts.isArchived, false),
        eq(contacts.isArchived, false),
      ),
    );
  const ids = rows.map((row) => row.id);
  const aliasRows = ids.length
    ? await executor
        .select()
        .from(contactEmailAliases)
        .where(inArray(contactEmailAliases.contactId, ids))
    : [];
  const emailsOf = (id: string, email: string | null) => {
    const set = new Set(aliasRows.filter((alias) => alias.contactId === id).map((alias) => alias.email));
    const normalized = normalizeEmail(email);
    if (normalized) set.add(normalized);
    return set;
  };
  const pairs: Array<{ a: string; b: string; reason: "email" | "name" }> = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const x = rows[i];
      const y = rows[j];
      const xEmails = emailsOf(x.id, x.email);
      const shared = [...emailsOf(y.id, y.email)].some((email) => xEmails.has(email));
      const sameName =
        normalizeContactName(x.name) !== null && normalizeContactName(x.name) === normalizeContactName(y.name);
      if (shared || sameName) pairs.push({ a: x.id, b: y.id, reason: shared ? "email" : "name" });
    }
  }
  return pairs;
}
