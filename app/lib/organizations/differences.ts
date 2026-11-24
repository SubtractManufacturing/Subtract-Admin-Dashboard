/**
 * The differences between the old Customers and Vendors (through the mapping)
 * and the new Organization records (ADR-0014 "One mapping, three users").
 *
 * One function, {@link computeChanges}, is the whole comparison. Check reports
 * its result; Sync applies the `op` each change carries. Because both read the
 * same list, "Check shows 0 differences" and "Sync has nothing to do" are the
 * same statement.
 *
 * Pure: it takes a snapshot of rows and returns a list. Loading the snapshot
 * and applying the ops live in `snapshot.server.ts` and `sync.server.ts`.
 *
 * What Sync will and will not do, decided here:
 * - It makes every copy equal to what the mapping gives, and makes the
 *   aliases, files and communications of a copy equal to the old row's.
 * - It deletes the copy of an old row that no longer exists.
 * - It never repairs a shape it does not expect (a record with no old row, a
 *   second Contact, an extra address). Those are reported as not fixable so a
 *   developer looks before anything is removed.
 */
import type {
  Account,
  Address,
  Contact,
  ContactEmailAlias,
  Customer,
  CustomerAttachment,
  CustomerCommunication,
  CustomerEmailAlias,
  Organization,
  OrganizationAttachment,
  OrganizationCommunication,
  OrganizationContact,
  Vendor,
  VendorAttachment,
} from "../db/schema";
import {
  mapLegacyParty,
  type AddressRole,
  type LegacyPartyRow,
  type LegacyType,
  type MappedAddress,
  type MappedParty,
} from "./mapping";

export type QuoteLink = {
  id: number;
  quoteNumber: string;
  customerId: number | null;
  vendorId: number | null;
  customerAccountId: string | null;
  vendorAccountId: string | null;
};
export type OrderLink = {
  id: number;
  orderNumber: string;
  customerId: number | null;
  vendorId: number | null;
  customerAccountId: string | null;
  vendorAccountId: string | null;
};
export type PartLink = {
  id: string;
  partName: string | null;
  customerId: number | null;
  customerAccountId: string | null;
};

/** Every row the comparison reads, as of one moment. */
export type Snapshot = {
  customers: Customer[];
  vendors: Vendor[];
  customerEmailAliases: CustomerEmailAlias[];
  customerAttachments: CustomerAttachment[];
  vendorAttachments: VendorAttachment[];
  customerCommunications: CustomerCommunication[];
  organizations: Organization[];
  contacts: Contact[];
  organizationContacts: OrganizationContact[];
  contactEmailAliases: ContactEmailAlias[];
  addresses: Address[];
  accounts: Account[];
  organizationAttachments: OrganizationAttachment[];
  organizationCommunications: OrganizationCommunication[];
  quotes: QuoteLink[];
  orders: OrderLink[];
  parts: PartLink[];
};

export type PartyKey = `${LegacyType}:${number}`;
export const partyKey = (type: LegacyType, id: number): PartyKey => `${type}:${id}`;

export type DifferenceArea =
  | "missing"
  | "organization"
  | "contact"
  | "account"
  | "address"
  | "alias"
  | "file"
  | "communication"
  | "merge"
  | "link"
  | "extra"
  | "structure";

export const AREA_LABELS: Record<DifferenceArea, string> = {
  missing: "Not copied yet",
  organization: "Organization",
  contact: "Contact",
  account: "Account",
  address: "Addresses",
  alias: "Email aliases",
  file: "Files",
  communication: "Communications",
  merge: "Merge pointers",
  link: "Quote, Order and Part links",
  extra: "New record with no old row",
  structure: "Unexpected shape",
};

/** One place where old and new are not equal. */
export type Difference = {
  area: DifferenceArea;
  legacyType: LegacyType | null;
  legacyId: number | null;
  /** The old row's display name, or the new record's name when there is no old row. */
  name: string | null;
  /** The record in today's app. */
  href: string | null;
  detail: string;
  /** False when Sync will not change this by itself. */
  fixable: boolean;
};

export type UpdatableTable =
  | "organizations"
  | "contacts"
  | "organizationContacts"
  | "accounts"
  | "addresses"
  | "organizationCommunications";

export type LinkTable = "quotes" | "orders" | "parts";
export type LinkColumn = "customerAccountId" | "vendorAccountId";

export type CommunicationCopy = Pick<
  OrganizationCommunication,
  "id" | "method" | "note" | "createdBy" | "createdAt" | "isArchived"
>;

/** What Sync does to remove one difference. */
export type Op =
  | { kind: "createParty"; party: PartyKey; legacyType: LegacyType; legacyId: number; mapped: MappedParty; updatedAt: Date }
  | { kind: "createContact"; party: PartyKey; organizationId: string; contact: MappedParty["contact"]; updatedAt: Date }
  | { kind: "update"; table: UpdatableTable; id: string; set: Record<string, unknown>; touchedAt: Date | null }
  | { kind: "createAddress"; organizationId: string; accountId: string; role: AddressRole; address: MappedAddress; createdAt: Date; updatedAt: Date }
  | { kind: "deleteAddress"; addressId: string }
  | { kind: "addAlias"; party: PartyKey; email: string; createdAt: Date }
  | { kind: "removeAlias"; contactId: string; email: string }
  | { kind: "addFile"; party: PartyKey; attachmentId: string; createdAt: Date }
  | { kind: "removeFile"; organizationId: string; attachmentId: string }
  | { kind: "addCommunication"; party: PartyKey; row: CommunicationCopy }
  | { kind: "moveCommunication"; id: string; party: PartyKey }
  | { kind: "removeCommunication"; id: string }
  | { kind: "setMergePointer"; party: PartyKey; target: PartyKey | null }
  | { kind: "setLink"; table: LinkTable; column: LinkColumn; id: number | string; target: PartyKey | null }
  | { kind: "deleteCopy"; organizationId: string };

export type Change = Difference & { op: Op | null };

/** The ids of a copy that already exists and has the expected shape. */
export type ExistingParty = {
  organizationId: string;
  accountId: string;
  contactId: string | null;
};

export type ChangeSet = {
  changes: Change[];
  /** Copies that exist, by old row. Sync adds the ones it creates. */
  parties: Map<PartyKey, ExistingParty>;
  counts: {
    customers: number;
    vendors: number;
    organizations: number;
    contacts: number;
    accounts: number;
    addresses: number;
  };
};

const hrefFor = (type: LegacyType, id: number) =>
  type === "customer" ? `/customers/${id}` : `/vendors/${id}`;

const noun = (type: LegacyType) => (type === "customer" ? "Customer" : "Vendor");

function show(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "yes" : "no";
  return JSON.stringify(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

export function toLegacyRow(
  type: LegacyType,
  row: Customer | Vendor,
  aliasEmails: readonly string[],
): LegacyPartyRow {
  const vendor = type === "vendor" ? (row as Vendor) : null;
  const customer = type === "customer" ? (row as Customer) : null;
  return {
    type,
    id: row.id,
    displayName: row.displayName,
    companyName: row.companyName,
    contactName: row.contactName,
    title: row.title,
    email: row.email,
    phone: row.phone,
    billingAddressLine1: row.billingAddressLine1,
    billingAddressLine2: row.billingAddressLine2,
    billingCity: row.billingCity,
    billingState: row.billingState,
    billingPostalCode: row.billingPostalCode,
    billingCountry: row.billingCountry,
    shippingAddressLine1: row.shippingAddressLine1,
    shippingAddressLine2: row.shippingAddressLine2,
    shippingCity: row.shippingCity,
    shippingState: row.shippingState,
    shippingPostalCode: row.shippingPostalCode,
    shippingCountry: row.shippingCountry,
    paymentTerms: row.paymentTerms,
    address: vendor?.address ?? null,
    notes: vendor?.notes ?? null,
    discordId: vendor?.discordId ?? null,
    mergedIntoCustomerId: customer?.mergedIntoCustomerId ?? null,
    isArchived: row.isArchived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    aliasEmails,
  };
}

const ADDRESS_FIELD_LABELS = {
  label: "label",
  line1: "line 1",
  line2: "line 2",
  city: "city",
  state: "state",
  postalCode: "postal code",
  country: "country",
  isDefaultShipping: "default shipping",
} as const;

/**
 * Compare a snapshot of the old rows with the new records. See the file
 * comment for what is and is not fixable.
 */
export function computeChanges(snapshot: Snapshot): ChangeSet {
  const changes: Change[] = [];
  const parties = new Map<PartyKey, ExistingParty>();

  const oldRows = new Map<PartyKey, { type: LegacyType; row: Customer | Vendor }>();
  for (const row of snapshot.customers) oldRows.set(partyKey("customer", row.id), { type: "customer", row });
  for (const row of snapshot.vendors) oldRows.set(partyKey("vendor", row.id), { type: "vendor", row });

  const aliasesByCustomer = groupBy(snapshot.customerEmailAliases, (alias) => alias.customerId);

  const organizationById = new Map(snapshot.organizations.map((org) => [org.id, org]));
  const contactById = new Map(snapshot.contacts.map((contact) => [contact.id, contact]));
  const addressById = new Map(snapshot.addresses.map((address) => [address.id, address]));
  const accountsByOrganization = groupBy(snapshot.accounts, (account) => account.organizationId);
  const linksByOrganization = groupBy(snapshot.organizationContacts, (link) => link.organizationId);
  const linksByContact = groupBy(snapshot.organizationContacts, (link) => link.contactId);
  const addressesByOrganization = groupBy(snapshot.addresses, (address) => address.organizationId);
  const aliasesByContact = groupBy(snapshot.contactEmailAliases, (alias) => alias.contactId);
  const filesByOrganization = groupBy(snapshot.organizationAttachments, (file) => file.organizationId);

  const organizationKeys = (org: Organization): PartyKey[] => [
    ...(org.legacyCustomerId !== null ? [partyKey("customer", org.legacyCustomerId)] : []),
    ...(org.legacyVendorId !== null ? [partyKey("vendor", org.legacyVendorId)] : []),
  ];
  const accountKeys = (account: Account): PartyKey[] => [
    ...(account.legacyCustomerId !== null ? [partyKey("customer", account.legacyCustomerId)] : []),
    ...(account.legacyVendorId !== null ? [partyKey("vendor", account.legacyVendorId)] : []),
  ];

  const organizationByKey = new Map<PartyKey, Organization>();
  for (const org of snapshot.organizations) {
    for (const key of organizationKeys(org)) organizationByKey.set(key, org);
  }
  const accountByKey = new Map<PartyKey, Account>();
  for (const account of snapshot.accounts) {
    for (const key of accountKeys(account)) accountByKey.set(key, account);
  }

  /** `new`: Sync will create the copy. `broken`: it exists in a shape Sync does not repair. */
  const partyState = new Map<PartyKey, "ok" | "new" | "broken">();
  const mappedByKey = new Map<PartyKey, MappedParty>();

  // -------------------------------------------------------------------------
  // Each old row against its copy
  // -------------------------------------------------------------------------
  for (const [key, { type, row }] of oldRows) {
    const legacy = toLegacyRow(
      type,
      row,
      type === "customer"
        ? (aliasesByCustomer.get(row.id) ?? []).map((alias) => alias.email)
        : [],
    );
    const mapped = mapLegacyParty(legacy);
    mappedByKey.set(key, mapped);

    const at = {
      legacyType: type,
      legacyId: row.id,
      name: row.displayName,
      href: hrefFor(type, row.id),
    };
    const structure = (detail: string) => {
      changes.push({ ...at, area: "structure", detail, fixable: false, op: null });
      partyState.set(key, "broken");
    };

    const org = organizationByKey.get(key);
    const account = accountByKey.get(key);

    if (!org && !account) {
      partyState.set(key, "new");
      changes.push({
        ...at,
        area: "missing",
        detail: `${noun(type)} ${row.id} has no copy: it becomes the ${mapped.organization.kind} "${mapped.organization.name}"`,
        fixable: true,
        op: { kind: "createParty", party: key, legacyType: type, legacyId: row.id, mapped, updatedAt: row.updatedAt },
      });
      continue;
    }
    if (!org || !account) {
      structure(
        org
          ? `Organization ${org.id} is a copy of this ${noun(type)}, but no account is`
          : `Account ${account!.id} is a copy of this ${noun(type)}, but no Organization is`,
      );
      continue;
    }
    if (account.organizationId !== org.id) {
      structure(`Account ${account.id} does not belong to Organization ${org.id}`);
      continue;
    }
    if (organizationKeys(org).length !== 1) {
      structure(`Organization ${org.id} is the copy of more than one old row`);
      continue;
    }
    if ((accountsByOrganization.get(org.id) ?? []).length !== 1) {
      structure(`Organization ${org.id} has more than one account`);
      continue;
    }
    const links = linksByOrganization.get(org.id) ?? [];
    if (links.length > 1) {
      structure(`Organization ${org.id} has ${links.length} Contacts; a copy has exactly one`);
      continue;
    }
    const link = links[0];
    const contact = link ? contactById.get(link.contactId) : undefined;
    if (contact && (linksByContact.get(contact.id) ?? []).length !== 1) {
      structure(`Contact ${contact.id} belongs to more than one Organization`);
      continue;
    }

    partyState.set(key, "ok");
    parties.set(key, {
      organizationId: org.id,
      accountId: account.id,
      contactId: contact?.id ?? null,
    });

    const fields = (
      area: DifferenceArea,
      what: string,
      table: UpdatableTable,
      id: string,
      actual: Record<string, unknown>,
      expected: Record<string, unknown>,
      labels: Record<string, string>,
      touch = true,
    ) => {
      for (const [field, label] of Object.entries(labels)) {
        if (sameValue(actual[field], expected[field])) continue;
        changes.push({
          ...at,
          area,
          detail: `${what} ${label} is ${show(actual[field])}; the old row gives ${show(expected[field])}`,
          fixable: true,
          op: {
            kind: "update",
            table,
            id,
            set: { [field]: expected[field] ?? null },
            touchedAt: touch ? row.updatedAt : null,
          },
        });
      }
    };

    fields(
      "organization",
      "Organization",
      "organizations",
      org.id,
      org,
      // Website and main phone have no old column, so a copy never has them.
      { ...mapped.organization, phone: null, website: null },
      { kind: "type", name: "name", isArchived: "archived", createdAt: "created", phone: "phone", website: "website" },
    );

    if (!contact) {
      changes.push({
        ...at,
        area: "contact",
        detail: `Organization ${org.id} has no Contact`,
        fixable: true,
        op: { kind: "createContact", party: key, organizationId: org.id, contact: mapped.contact, updatedAt: row.updatedAt },
      });
    } else {
      fields(
        "contact",
        "Contact",
        "contacts",
        contact.id,
        contact,
        { ...mapped.contact, mergedIntoContactId: null },
        {
          name: "name",
          title: "title",
          email: "email",
          phone: "phone",
          isArchived: "archived",
          createdAt: "created",
          mergedIntoContactId: "merge pointer",
        },
      );
      fields(
        "contact",
        "Contact link",
        "organizationContacts",
        link.id,
        link,
        { isPrimary: true, isArchived: false, role: null },
        { isPrimary: "primary", isArchived: "archived", role: "role" },
      );
    }

    fields(
      "account",
      "Account",
      "accounts",
      account.id,
      account,
      mapped.account,
      {
        paymentTerms: "payment terms",
        discordId: "Discord id",
        legacyAddress: "legacy address",
        notes: "notes",
        isArchived: "archived",
        createdAt: "created",
      },
    );

    // Addresses: the billing address is the one the account points at, the
    // shipping address is the active default one. Archived addresses are not
    // part of the copy and are ignored.
    const active = (addressesByOrganization.get(org.id) ?? []).filter((address) => !address.isArchived);
    const shippingRow = active.find((address) => address.isDefaultShipping);
    const pointed = account.billingAddressId ? addressById.get(account.billingAddressId) : undefined;
    const billingRow =
      pointed && pointed.organizationId === org.id && !pointed.isArchived && !pointed.isDefaultShipping
        ? pointed
        : undefined;

    const addressSlots: Array<[AddressRole, Address | undefined, MappedAddress | null]> = [
      ["billing", billingRow, mapped.billingAddress],
      ["shipping", shippingRow, mapped.shippingAddress],
    ];
    for (const [role, existing, wanted] of addressSlots) {
      if (wanted && existing) {
        fields("address", `The ${role} address`, "addresses", existing.id, existing, wanted, ADDRESS_FIELD_LABELS);
      } else if (wanted) {
        changes.push({
          ...at,
          area: "address",
          detail: `The ${role} address is missing`,
          fixable: true,
          op: {
            kind: "createAddress",
            organizationId: org.id,
            accountId: account.id,
            role,
            address: wanted,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        });
      } else if (existing) {
        changes.push({
          ...at,
          area: "address",
          detail: `The old row has no ${role} address any more, but the copy still has one`,
          fixable: true,
          op: { kind: "deleteAddress", addressId: existing.id },
        });
      }
    }
    if (account.billingAddressId && !billingRow && !mapped.billingAddress) {
      // Points at something that is not a billing address of this copy (the
      // shipping address, an archived one, another Organization's).
      fields(
        "address",
        "Account",
        "accounts",
        account.id,
        account,
        { billingAddressId: null },
        { billingAddressId: "billing address" },
      );
    }
    for (const address of active) {
      if (address.id === billingRow?.id || address.id === shippingRow?.id) continue;
      changes.push({
        ...at,
        area: "structure",
        detail: `Organization ${org.id} has an address (${address.id}) that is neither its billing nor its default shipping address`,
        fixable: false,
        op: null,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Aliases and files of each copy
  // -------------------------------------------------------------------------
  const filesByKey = new Map<PartyKey, Array<{ attachmentId: string; createdAt: Date }>>();
  for (const file of snapshot.customerAttachments) {
    const key = partyKey("customer", file.customerId);
    filesByKey.set(key, [...(filesByKey.get(key) ?? []), file]);
  }
  for (const file of snapshot.vendorAttachments) {
    const key = partyKey("vendor", file.vendorId);
    filesByKey.set(key, [...(filesByKey.get(key) ?? []), file]);
  }

  for (const [key, { type, row }] of oldRows) {
    const state = partyState.get(key);
    if (state === "broken") continue;
    const mapped = mappedByKey.get(key)!;
    const existing = parties.get(key);
    const at = { legacyType: type, legacyId: row.id, name: row.displayName, href: hrefFor(type, row.id) };

    const oldAliasCreatedAt = new Map(
      (type === "customer" ? (aliasesByCustomer.get(row.id) ?? []) : []).map((alias) => [alias.email, alias.createdAt]),
    );
    const actualAliases = new Set(
      existing?.contactId ? (aliasesByContact.get(existing.contactId) ?? []).map((alias) => alias.email) : [],
    );
    for (const email of mapped.aliases) {
      if (actualAliases.has(email)) continue;
      changes.push({
        ...at,
        area: "alias",
        detail: `The alias ${email} is missing from the Contact`,
        fixable: true,
        op: { kind: "addAlias", party: key, email, createdAt: oldAliasCreatedAt.get(email) ?? row.createdAt },
      });
    }
    // Vendors never had aliases in the old tables; extra ones on a Vendor's
    // Contact stay in the new tables (ADR-0014) and are not a difference.
    if (type === "customer" && existing?.contactId) {
      const wanted = new Set(mapped.aliases);
      for (const email of actualAliases) {
        if (wanted.has(email)) continue;
        changes.push({
          ...at,
          area: "alias",
          detail: `The Contact has the alias ${email}, which the Customer no longer has`,
          fixable: true,
          op: { kind: "removeAlias", contactId: existing.contactId, email },
        });
      }
    }

    const wantedFiles = filesByKey.get(key) ?? [];
    const actualFiles = new Set(
      existing ? (filesByOrganization.get(existing.organizationId) ?? []).map((file) => file.attachmentId) : [],
    );
    for (const file of wantedFiles) {
      if (actualFiles.has(file.attachmentId)) continue;
      changes.push({
        ...at,
        area: "file",
        detail: `The file ${file.attachmentId} is not linked to the Organization`,
        fixable: true,
        op: { kind: "addFile", party: key, attachmentId: file.attachmentId, createdAt: file.createdAt },
      });
    }
    if (existing) {
      const wanted = new Set(wantedFiles.map((file) => file.attachmentId));
      for (const attachmentId of actualFiles) {
        if (wanted.has(attachmentId)) continue;
        changes.push({
          ...at,
          area: "file",
          detail: `The Organization is linked to the file ${attachmentId}, which the ${noun(type)} no longer has`,
          fixable: true,
          op: { kind: "removeFile", organizationId: existing.organizationId, attachmentId },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Communications: same id, on the Organization of the Customer that has it
  // -------------------------------------------------------------------------
  const copiedCommunications = new Map(snapshot.organizationCommunications.map((row) => [row.id, row]));
  const oldCommunicationIds = new Set<string>();
  for (const old of snapshot.customerCommunications) {
    oldCommunicationIds.add(old.id);
    const key = partyKey("customer", old.customerId);
    const owner = oldRows.get(key);
    if (!owner || partyState.get(key) === "broken") continue;
    const at = {
      legacyType: "customer" as const,
      legacyId: old.customerId,
      name: owner.row.displayName,
      href: hrefFor("customer", old.customerId),
    };
    const copy = copiedCommunications.get(old.id);
    if (!copy) {
      changes.push({
        ...at,
        area: "communication",
        detail: `The communication ${old.id} is not copied`,
        fixable: true,
        op: {
          kind: "addCommunication",
          party: key,
          row: {
            id: old.id,
            method: old.method,
            note: old.note,
            createdBy: old.createdBy,
            createdAt: old.createdAt,
            isArchived: old.isArchived,
          },
        },
      });
      continue;
    }
    if (copy.organizationId !== parties.get(key)?.organizationId) {
      changes.push({
        ...at,
        area: "communication",
        detail: `The communication ${old.id} is on another Organization (the Customer it belongs to changed)`,
        fixable: true,
        op: { kind: "moveCommunication", id: old.id, party: key },
      });
    }
    const expected: Record<string, unknown> = {
      method: old.method,
      note: old.note,
      createdBy: old.createdBy,
      createdAt: old.createdAt,
      isArchived: old.isArchived,
      // The old table has no Contact on a communication.
      contactId: null,
    };
    const labels: Record<string, string> = {
      method: "method",
      note: "note",
      createdBy: "author",
      createdAt: "time",
      isArchived: "archived",
      contactId: "Contact",
    };
    for (const [field, label] of Object.entries(labels)) {
      const actual = (copy as Record<string, unknown>)[field];
      if (sameValue(actual, expected[field])) continue;
      changes.push({
        ...at,
        area: "communication",
        detail: `The communication ${old.id} ${label} is ${show(actual)}; the old row gives ${show(expected[field])}`,
        fixable: true,
        op: { kind: "update", table: "organizationCommunications", id: old.id, set: { [field]: expected[field] }, touchedAt: null },
      });
    }
  }
  for (const copy of snapshot.organizationCommunications) {
    if (oldCommunicationIds.has(copy.id)) continue;
    const org = organizationById.get(copy.organizationId);
    const legacyId = org?.legacyCustomerId ?? null;
    changes.push({
      area: "communication",
      legacyType: legacyId !== null ? "customer" : null,
      legacyId,
      name: org?.name ?? null,
      href: legacyId !== null && oldRows.has(partyKey("customer", legacyId)) ? hrefFor("customer", legacyId) : null,
      detail: `The communication ${copy.id} has no old row`,
      fixable: true,
      op: { kind: "removeCommunication", id: copy.id },
    });
  }

  // -------------------------------------------------------------------------
  // Merge pointers
  // -------------------------------------------------------------------------
  for (const [key, { type, row }] of oldRows) {
    const state = partyState.get(key);
    if (state === "broken") continue;
    const mapped = mappedByKey.get(key)!;
    const targetKey =
      mapped.mergedIntoLegacyCustomerId !== null
        ? partyKey("customer", mapped.mergedIntoLegacyCustomerId)
        : null;
    const actual = state === "ok" ? (organizationById.get(parties.get(key)!.organizationId)?.mergedIntoOrganizationId ?? null) : null;
    const at = { legacyType: type, legacyId: row.id, name: row.displayName, href: hrefFor(type, row.id) };

    if (targetKey === null) {
      if (actual === null) continue;
      changes.push({
        ...at,
        area: "merge",
        detail: `The Organization is marked as merged into ${actual}, but the ${noun(type)} is not merged`,
        fixable: true,
        op: { kind: "setMergePointer", party: key, target: null },
      });
      continue;
    }
    const targetState = partyState.get(targetKey);
    if (targetState === undefined || targetState === "broken") {
      changes.push({
        ...at,
        area: "merge",
        detail: `Merged into Customer ${mapped.mergedIntoLegacyCustomerId}, whose copy has to be repaired first`,
        fixable: false,
        op: null,
      });
      continue;
    }
    const expected = parties.get(targetKey)?.organizationId ?? null;
    if (expected !== null && actual === expected) continue;
    changes.push({
      ...at,
      area: "merge",
      detail: `Merged into Customer ${mapped.mergedIntoLegacyCustomerId}, but the Organization does not point at that Customer's Organization`,
      fixable: true,
      op: { kind: "setMergePointer", party: key, target: targetKey },
    });
  }

  // -------------------------------------------------------------------------
  // Quote, Order and Part links follow the old id
  // -------------------------------------------------------------------------
  const link = (
    table: LinkTable,
    column: LinkColumn,
    id: number | string,
    label: string,
    href: string | null,
    type: LegacyType,
    legacyId: number | null,
    actual: string | null,
  ) => {
    if (legacyId === null) {
      if (actual === null) return;
      changes.push({
        area: "link",
        legacyType: null,
        legacyId: null,
        name: label,
        href,
        detail: `${label} has no ${noun(type)}, but points at the account ${actual}`,
        fixable: true,
        op: { kind: "setLink", table, column, id, target: null },
      });
      return;
    }
    const key = partyKey(type, legacyId);
    const owner = oldRows.get(key);
    const at = {
      area: "link" as const,
      legacyType: type,
      legacyId,
      name: owner?.row.displayName ?? null,
      href: href ?? hrefFor(type, legacyId),
    };
    const state = partyState.get(key);
    if (state === undefined || state === "broken") {
      // The account that carries the legacy id is still the right target.
      const known = accountByKey.get(key)?.id;
      if (known && actual === known) return;
      changes.push({
        ...at,
        detail: `${label} belongs to ${noun(type)} ${legacyId}, whose copy has to be repaired first`,
        fixable: false,
        op: null,
      });
      return;
    }
    const expected = parties.get(key)?.accountId ?? null;
    if (expected !== null && actual === expected) return;
    changes.push({
      ...at,
      detail:
        actual === null
          ? `${label} is not linked to the account of ${noun(type)} ${legacyId}`
          : `${label} is linked to another account than that of ${noun(type)} ${legacyId}`,
      fixable: true,
      op: { kind: "setLink", table, column, id, target: key },
    });
  };

  for (const quote of snapshot.quotes) {
    const label = `Quote ${quote.quoteNumber}`;
    const href = `/quotes/${quote.id}`;
    link("quotes", "customerAccountId", quote.id, label, href, "customer", quote.customerId, quote.customerAccountId);
    link("quotes", "vendorAccountId", quote.id, label, href, "vendor", quote.vendorId, quote.vendorAccountId);
  }
  for (const order of snapshot.orders) {
    const label = `Order ${order.orderNumber}`;
    const href = `/orders/${encodeURIComponent(order.orderNumber)}`;
    link("orders", "customerAccountId", order.id, label, href, "customer", order.customerId, order.customerAccountId);
    link("orders", "vendorAccountId", order.id, label, href, "vendor", order.vendorId, order.vendorAccountId);
  }
  for (const part of snapshot.parts) {
    // Parts have no page of their own; the link goes to the Customer.
    link("parts", "customerAccountId", part.id, `Part ${part.partName ?? part.id}`, null, "customer", part.customerId, part.customerAccountId);
  }

  // -------------------------------------------------------------------------
  // New records with no old row
  // -------------------------------------------------------------------------
  const orphanOrganizations = new Set<string>();
  for (const org of snapshot.organizations) {
    const keys = organizationKeys(org);
    if (keys.length === 1 && oldRows.has(keys[0])) continue;
    if (keys.length === 1) {
      // The copy of an old row that was deleted. Nothing else can be its
      // source, so Sync removes it.
      const [type, id] = keys[0].split(":") as [LegacyType, string];
      orphanOrganizations.add(org.id);
      changes.push({
        area: "extra",
        legacyType: type,
        legacyId: Number(id),
        name: org.name,
        href: null,
        detail: `Organization ${org.id} is the copy of ${noun(type)} ${id}, which no longer exists`,
        fixable: true,
        op: { kind: "deleteCopy", organizationId: org.id },
      });
      continue;
    }
    if (keys.length === 0) {
      changes.push({
        area: "extra",
        legacyType: null,
        legacyId: null,
        name: org.name,
        href: null,
        detail: `Organization ${org.id} is not the copy of any old row`,
        fixable: false,
        op: null,
      });
    } else if (!keys.some((key) => oldRows.has(key))) {
      changes.push({
        area: "extra",
        legacyType: null,
        legacyId: null,
        name: org.name,
        href: null,
        detail: `Organization ${org.id} is the copy of more than one old row, none of which exists`,
        fixable: false,
        op: null,
      });
    }
  }
  for (const account of snapshot.accounts) {
    if (orphanOrganizations.has(account.organizationId)) continue;
    const keys = accountKeys(account);
    if (keys.some((key) => oldRows.has(key))) continue;
    const org = organizationById.get(account.organizationId);
    // A second account on a copy is reported with that copy.
    if (keys.length === 0 && org && organizationKeys(org).some((key) => oldRows.has(key))) continue;
    changes.push({
      area: "extra",
      legacyType: null,
      legacyId: null,
      name: org?.name ?? null,
      href: null,
      detail:
        keys.length === 0
          ? `Account ${account.id} is not the copy of any old row`
          : `Account ${account.id} is the copy of an old row that no longer exists, but its Organization is not`,
      fixable: false,
      op: null,
    });
  }
  for (const contact of snapshot.contacts) {
    if ((linksByContact.get(contact.id) ?? []).length > 0) continue;
    changes.push({
      area: "extra",
      legacyType: null,
      legacyId: null,
      name: contact.name ?? contact.email,
      href: null,
      detail: `Contact ${contact.id} does not belong to any Organization`,
      fixable: false,
      op: null,
    });
  }

  return {
    changes,
    parties,
    counts: {
      customers: snapshot.customers.length,
      vendors: snapshot.vendors.length,
      organizations: snapshot.organizations.length,
      contacts: snapshot.contacts.length,
      accounts: snapshot.accounts.length,
      addresses: snapshot.addresses.length,
    },
  };
}

/** A change without its op, for showing. */
export function toDifference(change: Change): Difference {
  return {
    area: change.area,
    legacyType: change.legacyType,
    legacyId: change.legacyId,
    name: change.name,
    href: change.href,
    detail: change.detail,
    fixable: change.fixable,
  };
}
