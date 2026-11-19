import { and, eq, inArray, max } from "drizzle-orm";

import type { db } from "../db";
import { normalizeEmail } from "../email-normalize";
import {
  accounts,
  contacts,
  organizationContacts,
  organizations,
  orders,
  quotes,
} from "../db/schema";
import {
  activeAccountIdsForContacts,
  createAccount,
  findActiveContactIdsByEmail,
  rememberContactEmail,
} from "../organizations/accounts.server";
import type { PreparedImport } from "./types";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type IntakeContact = PreparedImport["manifest"]["contact"];

export type IntakeCustomerResolution = {
  /** The customer account the Quote attaches to. */
  customerId: string;
  /**
   * Every active customer account that matched. More than one means a human
   * must review: intake attached the Quote to one of them and created nothing.
   */
  matchedCustomerIds: string[];
};

function fullName(contact: IntakeContact): string {
  return `${contact.firstName} ${contact.lastName}`.trim();
}

/** The candidate with the most recent Quote or Order; ties go to the oldest account. */
async function pickMostRecentlyActive(
  tx: DbTransaction,
  accountIds: string[],
): Promise<string> {
  const [quoteActivity, orderActivity, created] = await Promise.all([
    tx
      .select({ accountId: quotes.customerAccountId, latest: max(quotes.createdAt) })
      .from(quotes)
      .where(inArray(quotes.customerAccountId, accountIds))
      .groupBy(quotes.customerAccountId),
    tx
      .select({ accountId: orders.customerAccountId, latest: max(orders.createdAt) })
      .from(orders)
      .where(inArray(orders.customerAccountId, accountIds))
      .groupBy(orders.customerAccountId),
    tx
      .select({ id: accounts.id, createdAt: accounts.createdAt })
      .from(accounts)
      .where(inArray(accounts.id, accountIds)),
  ]);

  const latestByAccount = new Map<string, number>();
  for (const row of [...quoteActivity, ...orderActivity]) {
    if (row.accountId === null || row.latest === null) continue;
    const at = row.latest.getTime();
    latestByAccount.set(row.accountId, Math.max(at, latestByAccount.get(row.accountId) ?? at));
  }
  const createdAt = new Map(created.map((row) => [row.id, row.createdAt.getTime()]));

  return [...accountIds].sort((a, b) => {
    const aLatest = latestByAccount.get(a) ?? Number.NEGATIVE_INFINITY;
    const bLatest = latestByAccount.get(b) ?? Number.NEGATIVE_INFINITY;
    if (aLatest !== bLatest) return bLatest > aLatest ? 1 : -1;
    return (createdAt.get(a) ?? 0) - (createdAt.get(b) ?? 0) || a.localeCompare(b);
  })[0];
}

/** Fill only the blank name and phone of the Contact the email matched. */
async function fillBlankContactFields(
  tx: DbTransaction,
  contactIds: string[],
  contact: IntakeContact,
  now: Date,
) {
  const rows = await tx
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(inArray(contacts.id, contactIds));
  for (const row of rows) {
    const name = row.name || fullName(contact) || null;
    const phone = row.phone || contact.phone || null;
    if (name !== row.name || phone !== row.phone) {
      await tx
        .update(contacts)
        .set({ name, phone, updatedAt: now })
        .where(eq(contacts.id, row.id));
    }
  }
}

/** Active Organizations of these Contacts that have no customer account yet. */
async function organizationsWithoutCustomerAccount(
  tx: DbTransaction,
  contactIds: string[],
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: organizations.id })
    .from(organizationContacts)
    .innerJoin(organizations, eq(organizations.id, organizationContacts.organizationId))
    .where(
      and(
        inArray(organizationContacts.contactId, contactIds),
        eq(organizationContacts.isArchived, false),
        eq(organizations.isArchived, false),
      ),
    );
  if (rows.length === 0) return [];
  const withCustomer = await tx
    .select({ organizationId: accounts.organizationId })
    .from(accounts)
    .where(
      and(
        inArray(
          accounts.organizationId,
          rows.map((row) => row.id),
        ),
        eq(accounts.type, "customer"),
      ),
    );
  const taken = new Set(withCustomer.map((row) => row.organizationId));
  return rows.map((row) => row.id).filter((id) => !taken.has(id));
}

/**
 * Decide which customer account an incoming RFQ belongs to. Email is the only
 * automatic signal (ADR-0012, ADR-0013): it is matched against active
 * Contacts' primary emails and aliases, and resolves to their Organizations'
 * active customer accounts.
 *
 * - one match: reuse it, filling only the matched Contact's blank name/phone
 * - several matches: attach to the most recently active one, create nothing
 * - no match, but the Contact's only Organization has no customer account
 *   (a Vendor sending an RFQ): add a customer account to that Organization
 * - no match at all: create an Organization (`business` when the form gave a
 *   company, otherwise `individual`), its Contact and a customer account
 */
export async function resolveIntakeCustomer(
  tx: DbTransaction,
  contact: IntakeContact,
  now: Date,
): Promise<IntakeCustomerResolution> {
  const normalizedEmail = normalizeEmail(contact.email);
  const contactIds = normalizedEmail
    ? await findActiveContactIdsByEmail(tx, normalizedEmail)
    : [];
  const matches = await activeAccountIdsForContacts(tx, "customer", contactIds);

  if (matches.length > 1) {
    const chosen = await pickMostRecentlyActive(tx, matches);
    return { customerId: chosen, matchedCustomerIds: [...matches].sort() };
  }

  if (matches.length === 1) {
    await fillBlankContactFields(tx, contactIds, contact, now);
    for (const contactId of contactIds) {
      await rememberContactEmail(tx, contactId, normalizedEmail);
    }
    return { customerId: matches[0], matchedCustomerIds: matches };
  }

  if (contactIds.length > 0) {
    const orphanOrgs = await organizationsWithoutCustomerAccount(tx, contactIds);
    if (orphanOrgs.length === 1) {
      const created = await createAccount("customer", {}, { organizationId: orphanOrgs[0], now }, tx);
      await fillBlankContactFields(tx, contactIds, contact, now);
      return { customerId: created.id, matchedCustomerIds: [] };
    }
  }

  const company = contact.company?.trim() || null;
  const person = fullName(contact);
  const created = await createAccount(
    "customer",
    {
      name: company ?? person ?? normalizedEmail ?? contact.email,
      kind: company ? "business" : "individual",
      contactName: person || null,
      email: normalizedEmail ?? contact.email,
      phone: contact.phone,
    },
    { now },
    tx,
  );
  return { customerId: created.id, matchedCustomerIds: [] };
}
