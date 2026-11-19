/**
 * Customers and Vendors on the ADR-0013 model.
 *
 * Interface: read an account as a flat {@link AccountRecord}, write one from
 * the flat {@link AccountProfileInput}, and manage the Contacts and addresses
 * of its Organization. Behind it: `organizations`, `contacts`,
 * `organization_contacts`, `contact_email_aliases`, `addresses`, `accounts`.
 */
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../db";
import {
  accounts,
  addresses,
  contactEmailAliases,
  contacts,
  organizationContacts,
  organizations,
  type AccountType,
} from "../db/schema";
import { normalizeEmail } from "../email-normalize";
import {
  addressFromProfile,
  addressIsFilled,
  blankToNull,
  organizationFieldsFromInput,
} from "./profile";
import type {
  AccountProfileInput,
  AccountRecord,
  AddressInput,
  AddressRecord,
  ContactInput,
  ContactRecord,
  VendorRecord,
} from "./types";
import { isUuid } from "./types";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | DbTransaction;

const billingAddress = alias(addresses, "billing_address");
const shippingAddress = alias(addresses, "shipping_address");
const primaryLink = alias(organizationContacts, "primary_link");
const primaryContact = alias(contacts, "primary_contact");

const greatest = (...columns: SQL[]) =>
  sql<Date>`greatest(${sql.join(columns, sql`, `)})`.mapWith(accounts.updatedAt);

function recordQuery(executor: Executor) {
  return executor
    .select({
      account: accounts,
      organization: organizations,
      contact: primaryContact,
      billing: billingAddress,
      shipping: shippingAddress,
      updatedAt: greatest(
        sql`${accounts.updatedAt}`,
        sql`${organizations.updatedAt}`,
        sql`coalesce(${primaryContact.updatedAt}, ${accounts.updatedAt})`,
        sql`coalesce(${billingAddress.updatedAt}, ${accounts.updatedAt})`,
        sql`coalesce(${shippingAddress.updatedAt}, ${accounts.updatedAt})`,
      ),
    })
    .from(accounts)
    .innerJoin(organizations, eq(organizations.id, accounts.organizationId))
    .leftJoin(
      primaryLink,
      and(
        eq(primaryLink.organizationId, organizations.id),
        eq(primaryLink.isPrimary, true),
        eq(primaryLink.isArchived, false),
      ),
    )
    .leftJoin(primaryContact, eq(primaryContact.id, primaryLink.contactId))
    .leftJoin(billingAddress, eq(billingAddress.id, accounts.billingAddressId))
    .leftJoin(
      shippingAddress,
      and(
        eq(shippingAddress.organizationId, organizations.id),
        eq(shippingAddress.isDefaultShipping, true),
        eq(shippingAddress.isArchived, false),
      ),
    );
}

type RecordRow = Awaited<ReturnType<ReturnType<typeof recordQuery>["execute"]>>[number];

function toRecord(row: RecordRow): VendorRecord {
  const { account, organization, contact, billing, shipping } = row;
  return {
    id: account.id,
    type: account.type,
    organizationId: organization.id,
    kind: organization.kind,
    name: organization.name,
    displayName: organization.name,
    companyName: organization.kind === "business" ? organization.name : null,
    website: organization.website,
    organizationPhone: organization.phone,
    primaryContactId: contact?.id ?? null,
    contactName: contact?.name ?? null,
    title: contact?.title ?? null,
    email: contact?.email ?? null,
    phone: contact?.phone ?? organization.phone ?? null,
    billingAddressId: billing?.id ?? null,
    billingAddressLine1: billing?.line1 ?? null,
    billingAddressLine2: billing?.line2 ?? null,
    billingCity: billing?.city ?? null,
    billingState: billing?.state ?? null,
    billingPostalCode: billing?.postalCode ?? null,
    billingCountry: billing?.country ?? null,
    shippingAddressId: shipping?.id ?? null,
    shippingAddressLine1: shipping?.line1 ?? null,
    shippingAddressLine2: shipping?.line2 ?? null,
    shippingCity: shipping?.city ?? null,
    shippingState: shipping?.state ?? null,
    shippingPostalCode: shipping?.postalCode ?? null,
    shippingCountry: shipping?.country ?? null,
    paymentTerms: account.paymentTerms,
    discordId: account.discordId,
    address: account.legacyAddress,
    notes: account.notes,
    isArchived: account.isArchived || organization.isArchived,
    mergedIntoOrganizationId: organization.mergedIntoOrganizationId,
    createdAt: account.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type RecordFilter = {
  ids?: string[];
  organizationIds?: string[];
  /** Only active accounts on active Organizations. Default false. */
  activeOnly?: boolean;
};

/** Load accounts of one type as flat records, ordered by name. */
export async function loadAccountRecords(
  type: AccountType,
  filter: RecordFilter = {},
  executor: Executor = db,
): Promise<VendorRecord[]> {
  const conditions: SQL[] = [eq(accounts.type, type)];
  if (filter.ids) {
    const ids = filter.ids.filter(isUuid);
    if (ids.length === 0) return [];
    conditions.push(inArray(accounts.id, ids));
  }
  if (filter.organizationIds) {
    if (filter.organizationIds.length === 0) return [];
    conditions.push(inArray(accounts.organizationId, filter.organizationIds));
  }
  if (filter.activeOnly) {
    conditions.push(eq(accounts.isArchived, false), eq(organizations.isArchived, false));
  }
  const rows = await recordQuery(executor)
    .where(and(...conditions))
    .orderBy(asc(organizations.name), asc(accounts.createdAt));
  return rows.map(toRecord);
}

export async function loadAccountRecord(
  type: AccountType,
  id: string,
  executor: Executor = db,
): Promise<VendorRecord | null> {
  if (!isUuid(id)) return null;
  const [record] = await loadAccountRecords(type, { ids: [id] }, executor);
  return record ?? null;
}

/** Any-type lookup, for code that only has an account id. */
export async function loadAnyAccountRecord(
  id: string,
  executor: Executor = db,
): Promise<VendorRecord | null> {
  if (!isUuid(id)) return null;
  const [row] = await recordQuery(executor).where(eq(accounts.id, id)).limit(1);
  return row ? toRecord(row) : null;
}

/** Map account ids to records; unknown ids are absent from the map. */
export async function loadAccountRecordMap(
  type: AccountType,
  ids: Array<string | null | undefined>,
  executor: Executor = db,
): Promise<Map<string, VendorRecord>> {
  const wanted = [...new Set(ids.filter((id): id is string => isUuid(id)))];
  if (wanted.length === 0) return new Map();
  const records = await loadAccountRecords(type, { ids: wanted }, executor);
  return new Map(records.map((record) => [record.id, record]));
}

// ---------------------------------------------------------------------------
// Legacy ids and merge chains
// ---------------------------------------------------------------------------

/** The account that a legacy `/customers/123` or `/vendors/123` id became. */
export async function accountIdForLegacyId(
  type: AccountType,
  legacyId: number,
  executor: Executor = db,
): Promise<string | null> {
  if (!Number.isInteger(legacyId)) return null;
  const [row] = await executor
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      type === "customer"
        ? eq(accounts.legacyCustomerId, legacyId)
        : eq(accounts.legacyVendorId, legacyId),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Follow Organization merge pointers to the final active Organization.
 * Null when it does not exist or was archived without being merged.
 */
export async function resolveFinalOrganizationId(
  organizationId: string,
  executor: Executor = db,
): Promise<string | null> {
  const seen = new Set<string>();
  let current: string | null = organizationId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const [row] = await executor
      .select({
        id: organizations.id,
        isArchived: organizations.isArchived,
        mergedInto: organizations.mergedIntoOrganizationId,
      })
      .from(organizations)
      .where(eq(organizations.id, current))
      .limit(1);
    if (!row) return null;
    if (!row.isArchived) return row.id;
    current = row.mergedInto;
  }
  return null;
}

/**
 * The active account of the same type that `accountId` ended up as after
 * merges: the account itself when active, otherwise the survivor
 * Organization's account of that type. Null when nothing active remains.
 */
export async function resolveFinalAccountId(
  accountId: string,
  executor: Executor = db,
): Promise<string | null> {
  if (!isUuid(accountId)) return null;
  const [row] = await executor
    .select({
      id: accounts.id,
      type: accounts.type,
      isArchived: accounts.isArchived,
      organizationId: accounts.organizationId,
      orgArchived: organizations.isArchived,
    })
    .from(accounts)
    .innerJoin(organizations, eq(organizations.id, accounts.organizationId))
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!row) return null;
  if (!row.isArchived && !row.orgArchived) return row.id;
  const finalOrg = await resolveFinalOrganizationId(row.organizationId, executor);
  if (!finalOrg || finalOrg === row.organizationId) return null;
  const [survivor] = await executor
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.organizationId, finalOrg),
        eq(accounts.type, row.type),
        eq(accounts.isArchived, false),
      ),
    )
    .limit(1);
  return survivor?.id ?? null;
}

/** Other account types the Organization holds, for "also a vendor" links. */
export async function siblingAccounts(
  organizationId: string,
  executor: Executor = db,
): Promise<Array<{ id: string; type: AccountType; isArchived: boolean }>> {
  return executor
    .select({ id: accounts.id, type: accounts.type, isArchived: accounts.isArchived })
    .from(accounts)
    .where(eq(accounts.organizationId, organizationId))
    .orderBy(asc(accounts.type));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Record a Contact's normalized primary email as an alias. */
export async function rememberContactEmail(
  executor: Executor,
  contactId: string,
  email: string | null | undefined,
): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  await executor
    .insert(contactEmailAliases)
    .values({ contactId, email: normalized })
    .onConflictDoNothing();
}

/** Contact columns from a profile write: `contactName` is the person; `name` is the Organization. */
function contactFieldsFromProfile(input: AccountProfileInput) {
  return contactColumns({ name: input.contactName, title: input.title, email: input.email, phone: input.phone });
}

function contactColumns(input: ContactInput) {
  const fields: Partial<typeof contacts.$inferInsert> = {};
  if (input.name !== undefined) fields.name = blankToNull(input.name);
  if (input.title !== undefined) fields.title = blankToNull(input.title);
  if (input.email !== undefined) fields.email = blankToNull(input.email);
  if (input.phone !== undefined) fields.phone = blankToNull(input.phone);
  return fields;
}

function accountFields(input: AccountProfileInput, type: AccountType) {
  const fields: Partial<typeof accounts.$inferInsert> = {};
  if (input.paymentTerms !== undefined) fields.paymentTerms = blankToNull(input.paymentTerms);
  if (type === "vendor") {
    if (input.discordId !== undefined) fields.discordId = blankToNull(input.discordId);
    if (input.address !== undefined) fields.legacyAddress = blankToNull(input.address);
    if (input.notes !== undefined) fields.notes = blankToNull(input.notes);
  }
  return fields;
}

function organizationExtras(input: AccountProfileInput) {
  const fields: Partial<typeof organizations.$inferInsert> = {};
  if (input.website !== undefined) fields.website = blankToNull(input.website);
  if (input.organizationPhone !== undefined) fields.phone = blankToNull(input.organizationPhone);
  return fields;
}

export class AccountProfileError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "AccountProfileError";
  }
}

/**
 * Create an account. With `organizationId` it is added to an existing
 * Organization (a Customer becoming a Vendor too); otherwise a new
 * Organization, its primary Contact and its addresses are created.
 */
export async function createAccount(
  type: AccountType,
  input: AccountProfileInput,
  options: { organizationId?: string; now?: Date } = {},
  executor: Executor = db,
): Promise<VendorRecord> {
  const now = options.now ?? new Date();
  const run = async (tx: Executor) => {
    let organizationId = options.organizationId;
    if (!organizationId) {
      const orgFields = organizationFieldsFromInput(input);
      if (!orgFields) throw new AccountProfileError("A name is required");
      const [org] = await tx
        .insert(organizations)
        .values({ ...orgFields, ...organizationExtras(input), createdAt: now, updatedAt: now })
        .returning({ id: organizations.id });
      organizationId = org.id;

      const contact = contactFieldsFromProfile(input);
      if (Object.values(contact).some((value) => value !== null && value !== undefined)) {
        const [created] = await tx
          .insert(contacts)
          .values({ ...contact, createdAt: now, updatedAt: now })
          .returning({ id: contacts.id });
        await tx.insert(organizationContacts).values({
          organizationId,
          contactId: created.id,
          isPrimary: true,
          createdAt: now,
          updatedAt: now,
        });
        await rememberContactEmail(tx, created.id, contact.email);
      }

      const shipping = addressFromProfile(input, "shipping");
      if (addressIsFilled(shipping)) {
        await tx.insert(addresses).values({
          organizationId,
          label: "Shipping",
          ...shipping,
          country: shipping?.country ?? "US",
          isDefaultShipping: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    } else {
      const [existing] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.organizationId, organizationId), eq(accounts.type, type)))
        .limit(1);
      if (existing) {
        throw new AccountProfileError(`This Organization already has a ${type} account`, 409);
      }
    }

    let billingAddressId: string | null = null;
    const billing = addressFromProfile(input, "billing");
    if (addressIsFilled(billing)) {
      const [created] = await tx
        .insert(addresses)
        .values({
          organizationId,
          label: "Billing",
          ...billing,
          country: billing?.country ?? "US",
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: addresses.id });
      billingAddressId = created.id;
    }

    const [account] = await tx
      .insert(accounts)
      .values({
        organizationId,
        type,
        billingAddressId,
        ...accountFields(input, type),
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: accounts.id });
    const record = await loadAccountRecord(type, account.id, tx);
    if (!record) throw new Error("Created account could not be read back");
    return record;
  };
  return executor === db ? db.transaction(run) : run(executor);
}

async function upsertAddress(
  tx: Executor,
  existingId: string | null,
  organizationId: string,
  fields: Partial<AddressInput>,
  options: { label: string; isDefaultShipping: boolean; now: Date },
): Promise<string | null> {
  if (existingId) {
    await tx
      .update(addresses)
      .set({ ...fields, updatedAt: options.now })
      .where(eq(addresses.id, existingId));
    return existingId;
  }
  if (!addressIsFilled(fields)) return null;
  const [created] = await tx
    .insert(addresses)
    .values({
      organizationId,
      label: options.label,
      ...fields,
      country: fields.country ?? "US",
      isDefaultShipping: options.isDefaultShipping,
      createdAt: options.now,
      updatedAt: options.now,
    })
    .returning({ id: addresses.id });
  return created.id;
}

/**
 * Apply a partial profile write. Organization fields go to the Organization,
 * contact fields to the primary Contact (created when missing), `billing*` to
 * the account's billing address and `shipping*` to the default shipping
 * address. Returns the updated record.
 */
export async function updateAccountProfile(
  type: AccountType,
  accountId: string,
  input: AccountProfileInput,
  options: { now?: Date } = {},
  executor: Executor = db,
): Promise<VendorRecord> {
  const now = options.now ?? new Date();
  const run = async (tx: Executor) => {
    const current = await loadAccountRecord(type, accountId, tx);
    if (!current) throw new AccountProfileError(`${type === "customer" ? "Customer" : "Vendor"} not found`, 404);

    const orgFields = organizationFieldsFromInput(input, { name: current.name, kind: current.kind });
    const extras = organizationExtras(input);
    if (orgFields || Object.keys(extras).length > 0) {
      await tx
        .update(organizations)
        .set({ ...(orgFields ?? {}), ...extras, updatedAt: now })
        .where(eq(organizations.id, current.organizationId));
    }

    const contact = contactFieldsFromProfile(input);
    if (Object.keys(contact).length > 0) {
      if (current.primaryContactId) {
        await tx
          .update(contacts)
          .set({ ...contact, updatedAt: now })
          .where(eq(contacts.id, current.primaryContactId));
        await rememberContactEmail(tx, current.primaryContactId, contact.email);
      } else if (Object.values(contact).some((value) => value !== null)) {
        await addContact(current.organizationId, contactInputFromProfile(input), { makePrimary: true, now }, tx);
      }
    }

    const billing = addressFromProfile(input, "billing");
    if (billing) {
      const billingId = await upsertAddress(tx, current.billingAddressId, current.organizationId, billing, {
        label: "Billing",
        isDefaultShipping: false,
        now,
      });
      if (billingId !== current.billingAddressId) {
        await tx.update(accounts).set({ billingAddressId: billingId, updatedAt: now }).where(eq(accounts.id, accountId));
      }
    }

    const shipping = addressFromProfile(input, "shipping");
    if (shipping) {
      await upsertAddress(tx, current.shippingAddressId, current.organizationId, shipping, {
        label: "Shipping",
        isDefaultShipping: true,
        now,
      });
    }

    const fields = accountFields(input, type);
    if (Object.keys(fields).length > 0) {
      await tx.update(accounts).set({ ...fields, updatedAt: now }).where(eq(accounts.id, accountId));
    }

    const updated = await loadAccountRecord(type, accountId, tx);
    return updated!;
  };
  return executor === db ? db.transaction(run) : run(executor);
}

function contactInputFromProfile(input: AccountProfileInput): ContactInput {
  return { name: input.contactName, title: input.title, email: input.email, phone: input.phone };
}

/** Archive an account. Its Organization is archived too when it has no other active account. */
export async function archiveAccount(
  accountId: string,
  options: { now?: Date } = {},
  executor: Executor = db,
): Promise<void> {
  const now = options.now ?? new Date();
  const run = async (tx: Executor) => {
    const [account] = await tx
      .update(accounts)
      .set({ isArchived: true, updatedAt: now })
      .where(eq(accounts.id, accountId))
      .returning({ organizationId: accounts.organizationId });
    if (!account) return;
    const [otherActive] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.organizationId, account.organizationId),
          eq(accounts.isArchived, false),
          ne(accounts.id, accountId),
        ),
      )
      .limit(1);
    if (!otherActive) {
      await tx
        .update(organizations)
        .set({ isArchived: true, updatedAt: now })
        .where(eq(organizations.id, account.organizationId));
    }
  };
  await (executor === db ? db.transaction(run) : run(executor));
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function listOrganizationContacts(
  organizationId: string,
  executor: Executor = db,
): Promise<ContactRecord[]> {
  const rows = await executor
    .select({ link: organizationContacts, contact: contacts })
    .from(organizationContacts)
    .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
    .where(
      and(
        eq(organizationContacts.organizationId, organizationId),
        eq(organizationContacts.isArchived, false),
        eq(contacts.isArchived, false),
      ),
    )
    .orderBy(sql`${organizationContacts.isPrimary} desc`, asc(contacts.name), asc(contacts.createdAt));
  if (rows.length === 0) return [];
  const contactIds = rows.map((row) => row.contact.id);
  const [aliases, others] = await Promise.all([
    executor
      .select()
      .from(contactEmailAliases)
      .where(inArray(contactEmailAliases.contactId, contactIds)),
    executor
      .select({
        contactId: organizationContacts.contactId,
        id: organizations.id,
        name: organizations.name,
      })
      .from(organizationContacts)
      .innerJoin(organizations, eq(organizations.id, organizationContacts.organizationId))
      .where(
        and(
          inArray(organizationContacts.contactId, contactIds),
          ne(organizationContacts.organizationId, organizationId),
          eq(organizationContacts.isArchived, false),
          eq(organizations.isArchived, false),
        ),
      ),
  ]);
  return rows.map(({ link, contact }) => {
    const emails = new Set(
      aliases.filter((alias) => alias.contactId === contact.id).map((alias) => alias.email),
    );
    const primary = normalizeEmail(contact.email);
    if (primary) emails.add(primary);
    return {
      id: contact.id,
      linkId: link.id,
      name: contact.name,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      role: link.role,
      isPrimary: link.isPrimary,
      emails: [...emails].sort(),
      otherOrganizations: others
        .filter((other) => other.contactId === contact.id)
        .map(({ id, name }) => ({ id, name })),
    };
  });
}

async function clearPrimary(tx: Executor, organizationId: string, now: Date) {
  await tx
    .update(organizationContacts)
    .set({ isPrimary: false, updatedAt: now })
    .where(
      and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.isPrimary, true)),
    );
}

/** Add a new Contact to an Organization. The first Contact becomes primary. */
export async function addContact(
  organizationId: string,
  input: ContactInput,
  options: { makePrimary?: boolean; now?: Date } = {},
  executor: Executor = db,
): Promise<string> {
  const now = options.now ?? new Date();
  const run = async (tx: Executor) => {
    const fields = contactColumns(input);
    if (!fields.name && !fields.email && !fields.phone) {
      throw new AccountProfileError("A Contact needs a name, email or phone");
    }
    const [created] = await tx
      .insert(contacts)
      .values({ ...fields, createdAt: now, updatedAt: now })
      .returning({ id: contacts.id });
    const [existingPrimary] = await tx
      .select({ id: organizationContacts.id })
      .from(organizationContacts)
      .where(
        and(
          eq(organizationContacts.organizationId, organizationId),
          eq(organizationContacts.isPrimary, true),
          eq(organizationContacts.isArchived, false),
        ),
      )
      .limit(1);
    const makePrimary = options.makePrimary || !existingPrimary;
    if (makePrimary) await clearPrimary(tx, organizationId, now);
    await tx.insert(organizationContacts).values({
      organizationId,
      contactId: created.id,
      role: blankToNull(input.role),
      isPrimary: makePrimary,
      createdAt: now,
      updatedAt: now,
    });
    await rememberContactEmail(tx, created.id, fields.email);
    await tx.update(organizations).set({ updatedAt: now }).where(eq(organizations.id, organizationId));
    return created.id;
  };
  return executor === db ? db.transaction(run) : run(executor);
}

async function assertMember(tx: Executor, organizationId: string, contactId: string) {
  const [link] = await tx
    .select({ id: organizationContacts.id })
    .from(organizationContacts)
    .where(
      and(
        eq(organizationContacts.organizationId, organizationId),
        eq(organizationContacts.contactId, contactId),
        eq(organizationContacts.isArchived, false),
      ),
    )
    .limit(1);
  if (!link) throw new AccountProfileError("Contact not found on this Organization", 404);
  return link.id;
}

export async function updateContact(
  organizationId: string,
  contactId: string,
  input: ContactInput,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await db.transaction(async (tx) => {
    const linkId = await assertMember(tx, organizationId, contactId);
    const fields = contactColumns(input);
    if (Object.keys(fields).length > 0) {
      await tx.update(contacts).set({ ...fields, updatedAt: now }).where(eq(contacts.id, contactId));
      await rememberContactEmail(tx, contactId, fields.email);
    }
    if (input.role !== undefined) {
      await tx
        .update(organizationContacts)
        .set({ role: blankToNull(input.role), updatedAt: now })
        .where(eq(organizationContacts.id, linkId));
    }
    await tx.update(organizations).set({ updatedAt: now }).where(eq(organizations.id, organizationId));
  });
}

export async function setPrimaryContact(
  organizationId: string,
  contactId: string,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await db.transaction(async (tx) => {
    const linkId = await assertMember(tx, organizationId, contactId);
    await clearPrimary(tx, organizationId, now);
    await tx
      .update(organizationContacts)
      .set({ isPrimary: true, updatedAt: now })
      .where(eq(organizationContacts.id, linkId));
    await tx.update(organizations).set({ updatedAt: now }).where(eq(organizations.id, organizationId));
  });
}

/**
 * Remove a Contact from an Organization (the link is archived). The Contact
 * itself is archived when it belongs to no other active Organization. The
 * primary Contact can be removed only when another Contact takes over.
 */
export async function removeContact(
  organizationId: string,
  contactId: string,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await db.transaction(async (tx) => {
    const linkId = await assertMember(tx, organizationId, contactId);
    const [link] = await tx
      .select({ isPrimary: organizationContacts.isPrimary })
      .from(organizationContacts)
      .where(eq(organizationContacts.id, linkId));
    if (link.isPrimary) {
      const [next] = await tx
        .select({ id: organizationContacts.id })
        .from(organizationContacts)
        .where(
          and(
            eq(organizationContacts.organizationId, organizationId),
            eq(organizationContacts.isArchived, false),
            ne(organizationContacts.id, linkId),
          ),
        )
        .orderBy(asc(organizationContacts.createdAt))
        .limit(1);
      if (!next) {
        throw new AccountProfileError("The only Contact cannot be removed; edit it instead", 409);
      }
      await tx
        .update(organizationContacts)
        .set({ isPrimary: false, isArchived: true, updatedAt: now })
        .where(eq(organizationContacts.id, linkId));
      await tx
        .update(organizationContacts)
        .set({ isPrimary: true, updatedAt: now })
        .where(eq(organizationContacts.id, next.id));
    } else {
      await tx
        .update(organizationContacts)
        .set({ isArchived: true, updatedAt: now })
        .where(eq(organizationContacts.id, linkId));
    }
    const [elsewhere] = await tx
      .select({ id: organizationContacts.id })
      .from(organizationContacts)
      .where(and(eq(organizationContacts.contactId, contactId), eq(organizationContacts.isArchived, false)))
      .limit(1);
    if (!elsewhere) {
      await tx.update(contacts).set({ isArchived: true, updatedAt: now }).where(eq(contacts.id, contactId));
    }
    await tx.update(organizations).set({ updatedAt: now }).where(eq(organizations.id, organizationId));
  });
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export async function listOrganizationAddresses(
  organizationId: string,
  executor: Executor = db,
): Promise<AddressRecord[]> {
  const rows = await executor
    .select()
    .from(addresses)
    .where(and(eq(addresses.organizationId, organizationId), eq(addresses.isArchived, false)))
    .orderBy(sql`${addresses.isDefaultShipping} desc`, asc(addresses.createdAt));
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    isDefaultShipping: row.isDefaultShipping,
  }));
}

function addressFields(input: AddressInput) {
  const fields: Partial<typeof addresses.$inferInsert> = {};
  for (const key of ["label", "line1", "line2", "city", "state", "postalCode", "country"] as const) {
    if (input[key] !== undefined) fields[key] = blankToNull(input[key]);
  }
  return fields;
}

async function assertAddress(tx: Executor, organizationId: string, addressId: string) {
  const [row] = await tx
    .select({ id: addresses.id })
    .from(addresses)
    .where(
      and(
        eq(addresses.id, addressId),
        eq(addresses.organizationId, organizationId),
        eq(addresses.isArchived, false),
      ),
    )
    .limit(1);
  if (!row) throw new AccountProfileError("Address not found on this Organization", 404);
}

export async function addAddress(
  organizationId: string,
  input: AddressInput,
  options: { makeDefaultShipping?: boolean; now?: Date } = {},
): Promise<string> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    if (!addressIsFilled(input)) throw new AccountProfileError("An address needs a street, city or postal code");
    const [existingDefault] = await tx
      .select({ id: addresses.id })
      .from(addresses)
      .where(
        and(
          eq(addresses.organizationId, organizationId),
          eq(addresses.isDefaultShipping, true),
          eq(addresses.isArchived, false),
        ),
      )
      .limit(1);
    const makeDefault = options.makeDefaultShipping || !existingDefault;
    if (makeDefault && existingDefault) {
      await tx.update(addresses).set({ isDefaultShipping: false, updatedAt: now }).where(eq(addresses.id, existingDefault.id));
    }
    const fields = addressFields(input);
    const [created] = await tx
      .insert(addresses)
      .values({
        organizationId,
        ...fields,
        country: fields.country ?? "US",
        isDefaultShipping: makeDefault,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: addresses.id });
    await tx.update(organizations).set({ updatedAt: now }).where(eq(organizations.id, organizationId));
    return created.id;
  });
}

export async function updateAddress(
  organizationId: string,
  addressId: string,
  input: AddressInput,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await db.transaction(async (tx) => {
    await assertAddress(tx, organizationId, addressId);
    await tx.update(addresses).set({ ...addressFields(input), updatedAt: now }).where(eq(addresses.id, addressId));
  });
}

export async function setDefaultShippingAddress(
  organizationId: string,
  addressId: string,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await db.transaction(async (tx) => {
    await assertAddress(tx, organizationId, addressId);
    await tx
      .update(addresses)
      .set({ isDefaultShipping: false, updatedAt: now })
      .where(and(eq(addresses.organizationId, organizationId), eq(addresses.isDefaultShipping, true)));
    await tx.update(addresses).set({ isDefaultShipping: true, updatedAt: now }).where(eq(addresses.id, addressId));
  });
}

/** Point an account's billing address at one of its Organization's addresses. */
export async function setBillingAddress(
  accountId: string,
  addressId: string | null,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await db.transaction(async (tx) => {
    const [account] = await tx
      .select({ organizationId: accounts.organizationId })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!account) throw new AccountProfileError("Account not found", 404);
    if (addressId) await assertAddress(tx, account.organizationId, addressId);
    await tx.update(accounts).set({ billingAddressId: addressId, updatedAt: now }).where(eq(accounts.id, accountId));
  });
}

/**
 * Archive an address. A billing address stays in use until the account points
 * elsewhere, so archiving one that an active account bills to is refused.
 */
export async function archiveAddress(
  organizationId: string,
  addressId: string,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await db.transaction(async (tx) => {
    await assertAddress(tx, organizationId, addressId);
    const [billedBy] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.billingAddressId, addressId), eq(accounts.isArchived, false)))
      .limit(1);
    if (billedBy) {
      throw new AccountProfileError("This is the billing address; choose another billing address first", 409);
    }
    await tx
      .update(addresses)
      .set({ isArchived: true, isDefaultShipping: false, updatedAt: now })
      .where(eq(addresses.id, addressId));
  });
}

// ---------------------------------------------------------------------------
// Lookups used by matching and merge
// ---------------------------------------------------------------------------

/** Active Contacts whose primary email or an alias equals `normalizedEmail`. */
export async function findActiveContactIdsByEmail(
  executor: Executor,
  normalizedEmail: string,
): Promise<string[]> {
  const rows = await executor
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.isArchived, false),
        isNull(contacts.mergedIntoContactId),
        sql`(
          lower(trim(${contacts.email})) = ${normalizedEmail}
          or exists (
            select 1 from ${contactEmailAliases}
            where ${contactEmailAliases.contactId} = ${contacts.id}
              and ${contactEmailAliases.email} = ${normalizedEmail}
          )
        )`,
      ),
    );
  return rows.map((row) => row.id);
}

/** Active accounts of `type` on active Organizations that list one of these Contacts. */
export async function activeAccountIdsForContacts(
  executor: Executor,
  type: AccountType,
  contactIds: string[],
): Promise<string[]> {
  if (contactIds.length === 0) return [];
  const rows = await executor
    .selectDistinct({ id: accounts.id })
    .from(organizationContacts)
    .innerJoin(organizations, eq(organizations.id, organizationContacts.organizationId))
    .innerJoin(accounts, eq(accounts.organizationId, organizations.id))
    .where(
      and(
        inArray(organizationContacts.contactId, contactIds),
        eq(organizationContacts.isArchived, false),
        eq(organizations.isArchived, false),
        eq(accounts.type, type),
        eq(accounts.isArchived, false),
      ),
    );
  return rows.map((row) => row.id);
}

export type { AccountRecord };
