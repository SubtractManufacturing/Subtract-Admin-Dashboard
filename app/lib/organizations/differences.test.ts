/**
 * `computeChanges` on hand-built snapshots: the states that are awkward to
 * reach through the database. The integration tests cover the ordinary ones.
 */
import { describe, expect, it } from "vitest";

import type {
  Account,
  Address,
  Contact,
  Customer,
  Organization,
  OrganizationContact,
  Vendor,
} from "../db/schema";
import { computeChanges, type Change, type Snapshot } from "./differences";

const at = new Date("2026-01-02T03:04:05.000Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function customer(id: number, over: Partial<Customer> = {}): Customer {
  return {
    id,
    displayName: `Customer ${id}`,
    companyName: null,
    contactName: null,
    title: null,
    email: null,
    phone: null,
    isPrimaryContact: false,
    billingAddressLine1: null,
    billingAddressLine2: null,
    billingCity: null,
    billingState: null,
    billingPostalCode: null,
    billingCountry: "US",
    shippingAddressLine1: null,
    shippingAddressLine2: null,
    shippingCity: null,
    shippingState: null,
    shippingPostalCode: null,
    shippingCountry: "US",
    paymentTerms: null,
    mergedIntoCustomerId: null,
    isArchived: false,
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

function vendor(id: number, over: Partial<Vendor> = {}): Vendor {
  const base: Partial<Customer> = customer(id);
  delete base.mergedIntoCustomerId;
  return {
    ...(base as Omit<Customer, "mergedIntoCustomerId">),
    displayName: `Vendor ${id}`,
    address: null,
    notes: null,
    discordId: null,
    ...over,
  };
}

function empty(): Snapshot {
  return {
    customers: [],
    vendors: [],
    customerEmailAliases: [],
    customerAttachments: [],
    vendorAttachments: [],
    customerCommunications: [],
    organizations: [],
    contacts: [],
    organizationContacts: [],
    contactEmailAliases: [],
    addresses: [],
    accounts: [],
    organizationAttachments: [],
    organizationCommunications: [],
    quotes: [],
    orders: [],
    parts: [],
  };
}

/** A snapshot in which the given old rows are already copied correctly. */
function copied(rows: { customers?: Customer[]; vendors?: Vendor[] }): Snapshot {
  const snapshot = empty();
  let n = 0;
  const add = (type: "customer" | "vendor", row: Customer | Vendor) => {
    n += 1;
    const organization: Organization = {
      id: uuid(n * 10 + 1),
      kind: row.companyName ? "business" : "individual",
      name: row.companyName ?? row.displayName,
      phone: null,
      website: null,
      mergedIntoOrganizationId: null,
      legacyCustomerId: type === "customer" ? row.id : null,
      legacyVendorId: type === "vendor" ? row.id : null,
      isArchived: row.isArchived,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    const contact: Contact = {
      id: uuid(n * 10 + 2),
      name: row.contactName ?? (row.companyName ? null : row.displayName),
      title: null,
      email: row.email,
      phone: null,
      mergedIntoContactId: null,
      isArchived: row.isArchived,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    const link: OrganizationContact = {
      id: uuid(n * 10 + 3),
      organizationId: organization.id,
      contactId: contact.id,
      role: null,
      isPrimary: true,
      isArchived: false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    const account: Account = {
      id: uuid(n * 10 + 4),
      organizationId: organization.id,
      type,
      paymentTerms: null,
      billingAddressId: null,
      discordId: null,
      legacyAddress: null,
      notes: null,
      legacyCustomerId: type === "customer" ? row.id : null,
      legacyVendorId: type === "vendor" ? row.id : null,
      isArchived: row.isArchived,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    snapshot.organizations.push(organization);
    snapshot.contacts.push(contact);
    snapshot.organizationContacts.push(link);
    snapshot.accounts.push(account);
    if (row.email) snapshot.contactEmailAliases.push({ contactId: contact.id, email: row.email, createdAt: at });
  };
  for (const row of rows.customers ?? []) {
    snapshot.customers.push(row);
    add("customer", row);
  }
  for (const row of rows.vendors ?? []) {
    snapshot.vendors.push(row);
    add("vendor", row);
  }
  return snapshot;
}

function address(n: number, organizationId: string, over: Partial<Address> = {}): Address {
  return {
    id: uuid(n),
    organizationId,
    label: "Billing",
    line1: "1 Main St",
    line2: null,
    city: null,
    state: null,
    postalCode: null,
    country: "US",
    isDefaultShipping: false,
    isArchived: false,
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

const kinds = (changes: Change[]) => changes.map((change) => `${change.area}:${change.op?.kind ?? "none"}`);

describe("computeChanges", () => {
  it("finds nothing when every old row is copied correctly", () => {
    const snapshot = copied({
      customers: [customer(1, { email: "one@example.invalid" }), customer(2, { companyName: "Two Co", contactName: "Pat" })],
      vendors: [vendor(1)],
    });
    expect(computeChanges(snapshot).changes).toEqual([]);
  });

  it("knows the ids of the copies that exist, and none for one that does not", () => {
    const snapshot = copied({ customers: [customer(1)] });
    snapshot.customers.push(customer(2));
    const { changes, parties } = computeChanges(snapshot);
    expect(parties.get("customer:1")).toEqual({
      organizationId: snapshot.organizations[0].id,
      accountId: snapshot.accounts[0].id,
      contactId: snapshot.contacts[0].id,
    });
    expect(parties.has("customer:2")).toBe(false);
    expect(kinds(changes)).toEqual(["missing:createParty"]);
  });

  it("removes an alias a Customer no longer has, and keeps the normalized primary email", () => {
    const snapshot = copied({ customers: [customer(1, { email: " <One@Example.invalid> " })] });
    snapshot.contactEmailAliases = [
      { contactId: snapshot.contacts[0].id, email: "one@example.invalid", createdAt: at },
      { contactId: snapshot.contacts[0].id, email: "old@example.invalid", createdAt: at },
    ];
    snapshot.contacts[0].email = "<One@Example.invalid>";
    const { changes } = computeChanges(snapshot);
    expect(changes.map((change) => change.op)).toEqual([
      { kind: "removeAlias", contactId: snapshot.contacts[0].id, email: "old@example.invalid" },
    ]);
  });

  it("leaves extra aliases on a Vendor's Contact alone (ADR-0014), but still adds a missing one", () => {
    const snapshot = copied({ vendors: [vendor(1, { email: "shop@example.invalid" })] });
    snapshot.contactEmailAliases = [
      { contactId: snapshot.contacts[0].id, email: "extra@example.invalid", createdAt: at },
    ];
    const { changes } = computeChanges(snapshot);
    expect(changes.map((change) => change.op)).toEqual([
      { kind: "addAlias", party: "vendor:1", email: "shop@example.invalid", createdAt: at },
    ]);
  });

  it("does not add the same alias twice when an old alias equals the primary email", () => {
    const snapshot = copied({ customers: [customer(1, { email: "one@example.invalid" })] });
    snapshot.customerEmailAliases = [{ customerId: 1, email: "one@example.invalid", createdAt: at }];
    snapshot.contactEmailAliases = [];
    expect(computeChanges(snapshot).changes.map((change) => change.op?.kind)).toEqual(["addAlias"]);
  });

  it("clears a billing pointer that aims at the shipping address", () => {
    const snapshot = copied({ customers: [customer(1, { shippingAddressLine1: "2 Dock Rd" })] });
    const shipping = address(900, snapshot.organizations[0].id, { label: "Shipping", line1: "2 Dock Rd", isDefaultShipping: true });
    snapshot.addresses = [shipping];
    snapshot.accounts[0].billingAddressId = shipping.id;
    const { changes } = computeChanges(snapshot);
    expect(changes.map((change) => change.op)).toEqual([
      { kind: "update", table: "accounts", id: snapshot.accounts[0].id, set: { billingAddressId: null }, touchedAt: at },
    ]);
  });

  it("creates a billing address of its own when the pointer aims at the shipping address", () => {
    const snapshot = copied({
      customers: [customer(1, { billingAddressLine1: "1 Main St", shippingAddressLine1: "2 Dock Rd" })],
    });
    const shipping = address(900, snapshot.organizations[0].id, { label: "Shipping", line1: "2 Dock Rd", isDefaultShipping: true });
    snapshot.addresses = [shipping];
    snapshot.accounts[0].billingAddressId = shipping.id;
    expect(kinds(computeChanges(snapshot).changes)).toEqual(["address:createAddress"]);
  });

  it("deletes an address the old row no longer has, and ignores archived ones", () => {
    const snapshot = copied({ customers: [customer(1)] });
    const billing = address(900, snapshot.organizations[0].id);
    snapshot.addresses = [billing, address(901, snapshot.organizations[0].id, { isArchived: true })];
    snapshot.accounts[0].billingAddressId = billing.id;
    expect(computeChanges(snapshot).changes.map((change) => change.op)).toEqual([
      { kind: "deleteAddress", addressId: billing.id },
    ]);
  });

  it("reports an address that is neither billing nor shipping, and does not remove it", () => {
    const snapshot = copied({ customers: [customer(1)] });
    snapshot.addresses = [address(900, snapshot.organizations[0].id, { label: "Warehouse" })];
    const { changes } = computeChanges(snapshot);
    expect(changes).toEqual([expect.objectContaining({ area: "structure", fixable: false, op: null })]);
  });

  it("recreates a Contact that is missing", () => {
    const snapshot = copied({ customers: [customer(1, { email: "one@example.invalid" })] });
    snapshot.organizationContacts = [];
    snapshot.contactEmailAliases = [];
    snapshot.contacts = [];
    expect(kinds(computeChanges(snapshot).changes)).toEqual(["contact:createContact", "alias:addAlias"]);
  });

  it.each([
    ["an Organization without its account", (s: Snapshot) => void (s.accounts = [])],
    ["an account without its Organization", (s: Snapshot) => void (s.organizations[0].legacyCustomerId = null)],
    [
      "an account on another Organization",
      (s: Snapshot) => {
        s.organizations.push({ ...s.organizations[0], id: uuid(999), legacyCustomerId: null });
        s.accounts[0].organizationId = uuid(999);
      },
    ],
    ["an Organization that copies two old rows", (s: Snapshot) => void (s.organizations[0].legacyVendorId = 77)],
    [
      "a second account",
      (s: Snapshot) => void s.accounts.push({ ...s.accounts[0], id: uuid(998), type: "vendor", legacyCustomerId: null }),
    ],
    [
      "a second Contact",
      (s: Snapshot) => {
        s.contacts.push({ ...s.contacts[0], id: uuid(997) });
        s.organizationContacts.push({ ...s.organizationContacts[0], id: uuid(996), contactId: uuid(997), isPrimary: false });
      },
    ],
  ])("does not repair %s", (_name, damage) => {
    const snapshot = copied({ customers: [customer(1, { email: "one@example.invalid" })] });
    damage(snapshot);
    // An edit is waiting too; it must not be applied to a copy in this state.
    snapshot.customers[0] = { ...snapshot.customers[0], companyName: "Edited Co" };
    const { changes, parties } = computeChanges(snapshot);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.filter((change) => change.fixable)).toEqual([]);
    expect(changes.every((change) => change.op === null)).toBe(true);
    expect(parties.has("customer:1")).toBe(false);
  });

  it("does not repair a Contact shared by two Organizations", () => {
    const snapshot = copied({ customers: [customer(1), customer(2)] });
    snapshot.organizationContacts[1].contactId = snapshot.contacts[0].id;
    snapshot.contacts.pop();
    const { changes } = computeChanges(snapshot);
    expect(changes.map((change) => [change.legacyId, change.fixable])).toEqual([
      [1, false],
      [2, false],
    ]);
  });

  it("removes the copy of an old row that no longer exists, and reports records that copy nothing", () => {
    const snapshot = copied({ customers: [customer(1), customer(2)] });
    snapshot.customers = [snapshot.customers[0]];
    snapshot.organizations.push({ ...snapshot.organizations[0], id: uuid(950), name: "Loose", legacyCustomerId: null });
    snapshot.contacts.push({ ...snapshot.contacts[0], id: uuid(951), name: "Nobody" });
    const { changes } = computeChanges(snapshot);
    expect(changes.map((change) => [change.area, change.fixable, change.op?.kind ?? null])).toEqual([
      ["extra", true, "deleteCopy"],
      ["extra", false, null],
      ["extra", false, null],
    ]);
    expect(changes[0]).toMatchObject({ legacyType: "customer", legacyId: 2 });
  });

  it("does not create an address beside one nobody claims (its pointer may just be lost)", () => {
    const snapshot = copied({ customers: [customer(1, { billingAddressLine1: "1 Main St" })] });
    // The billing row is there, but the account no longer points at it.
    snapshot.addresses = [address(900, snapshot.organizations[0].id)];
    const { changes } = computeChanges(snapshot);
    expect(changes).toEqual([
      expect.objectContaining({
        area: "structure",
        fixable: false,
        op: null,
        detail: expect.stringContaining("the billing address is missing and is not created"),
      }),
    ]);
  });

  describe("the copy of a deleted old row", () => {
    /** Customer 2 was deleted; its copy is still there. */
    function withOrphan() {
      const snapshot = copied({ customers: [customer(1), customer(2)] });
      snapshot.customers = [snapshot.customers[0]];
      return snapshot;
    }
    const orphanChange = (snapshot: Snapshot) =>
      computeChanges(snapshot).changes.find((change) => change.area === "extra")!;

    it("is removed when nothing depends on it", () => {
      expect(orphanChange(withOrphan())).toMatchObject({ fixable: true, op: { kind: "deleteCopy" } });
    });

    it("is removed together with a Quote link that this pass moves away", () => {
      const snapshot = withOrphan();
      snapshot.quotes = [
        { id: 1, quoteNumber: "Q1", customerId: 1, vendorId: null, customerAccountId: snapshot.accounts[1].id, vendorAccountId: null },
      ];
      const { changes } = computeChanges(snapshot);
      expect(changes.map((change) => [change.area, change.fixable])).toEqual([
        ["link", true],
        ["extra", true],
      ]);
    });

    it("stays while a Quote Sync cannot repoint still uses its account", () => {
      const snapshot = withOrphan();
      // The Quote now belongs to Customer 1, whose copy has a second Contact.
      snapshot.quotes = [
        { id: 1, quoteNumber: "Q1", customerId: 1, vendorId: null, customerAccountId: snapshot.accounts[1].id, vendorAccountId: null },
      ];
      snapshot.contacts.push({ ...snapshot.contacts[0], id: uuid(997) });
      snapshot.organizationContacts.push({
        ...snapshot.organizationContacts[0],
        id: uuid(996),
        contactId: uuid(997),
        isPrimary: false,
      });
      const { changes } = computeChanges(snapshot);
      expect(changes.filter((change) => change.fixable)).toEqual([]);
      expect(orphanChange(snapshot)).toMatchObject({
        fixable: false,
        op: null,
        detail: expect.stringContaining("not removed yet: a Quote, Order or Part"),
      });
    });

    it("stays when it holds the account of an old row that still exists", () => {
      const snapshot = withOrphan();
      // Customer 1's account sits on the orphan Organization.
      snapshot.accounts[0].organizationId = snapshot.organizations[1].id;
      const { changes } = computeChanges(snapshot);
      expect(changes.filter((change) => change.fixable)).toEqual([]);
      expect(orphanChange(snapshot).detail).toContain("it holds the account of an old row that still exists");
    });

    it("stays while a record Sync is not changing is marked as merged into it", () => {
      const snapshot = withOrphan();
      snapshot.organizations.push({
        ...snapshot.organizations[0],
        id: uuid(950),
        name: "Loose",
        legacyCustomerId: null,
        mergedIntoOrganizationId: snapshot.organizations[1].id,
      });
      expect(orphanChange(snapshot)).toMatchObject({
        fixable: false,
        detail: expect.stringContaining(`Organization ${uuid(950)} is marked as merged into it`),
      });
    });

    it("is removed when the pointer at it is one this pass clears, or belongs to another removed copy", () => {
      const snapshot = copied({ customers: [customer(1), customer(2), customer(3)] });
      snapshot.customers = [snapshot.customers[0]];
      const [one, two, three] = snapshot.organizations;
      one.mergedIntoOrganizationId = two.id; // cleared by this pass: Customer 1 is not merged
      three.mergedIntoOrganizationId = two.id; // another orphan
      const { changes } = computeChanges(snapshot);
      expect(changes.map((change) => [change.area, change.fixable, change.op?.kind])).toEqual([
        ["merge", true, "setMergePointer"],
        ["extra", true, "deleteCopy"],
        ["extra", true, "deleteCopy"],
      ]);
    });
  });

  it("follows the old ids on Quotes, Orders and Parts, including a cleared one", () => {
    const snapshot = copied({ customers: [customer(1), customer(2)], vendors: [vendor(1)] });
    const [first, second, shop] = snapshot.accounts;
    snapshot.quotes = [
      { id: 1, quoteNumber: "Q1", customerId: 1, vendorId: 1, customerAccountId: first.id, vendorAccountId: shop.id },
      { id: 2, quoteNumber: "Q2", customerId: 2, vendorId: null, customerAccountId: first.id, vendorAccountId: shop.id },
    ];
    snapshot.orders = [
      { id: 3, orderNumber: "O3", customerId: null, vendorId: null, customerAccountId: null, vendorAccountId: null },
      { id: 4, orderNumber: "O4", customerId: 2, vendorId: 1, customerAccountId: null, vendorAccountId: shop.id },
    ];
    snapshot.parts = [{ id: uuid(5), partName: "P", customerId: 1, customerAccountId: second.id }];
    expect(computeChanges(snapshot).changes.map((change) => change.op)).toEqual([
      { kind: "setLink", table: "quotes", column: "customerAccountId", id: 2, target: "customer:2" },
      { kind: "setLink", table: "quotes", column: "vendorAccountId", id: 2, target: null },
      { kind: "setLink", table: "orders", column: "customerAccountId", id: 4, target: "customer:2" },
      { kind: "setLink", table: "parts", column: "customerAccountId", id: uuid(5), target: "customer:1" },
    ]);
  });

  it("sets and clears merge pointers, also along a chain", () => {
    const snapshot = copied({
      customers: [customer(1), customer(2, { isArchived: true, mergedIntoCustomerId: 1 }), customer(3, { isArchived: true, mergedIntoCustomerId: 2 })],
    });
    const [one, two, three] = snapshot.organizations;
    two.mergedIntoOrganizationId = one.id;
    three.mergedIntoOrganizationId = one.id;
    one.mergedIntoOrganizationId = three.id;
    expect(computeChanges(snapshot).changes.map((change) => change.op)).toEqual([
      { kind: "setMergePointer", party: "customer:1", target: null },
      { kind: "setMergePointer", party: "customer:3", target: "customer:2" },
    ]);
  });

  it("moves, corrects and removes communications by their id", () => {
    const snapshot = copied({ customers: [customer(1), customer(2)] });
    const old = { method: "call" as const, createdBy: "user", createdAt: at, isArchived: false };
    snapshot.customerCommunications = [
      { id: uuid(801), customerId: 2, note: "Moved by a merge", ...old },
      { id: uuid(802), customerId: 1, note: "Edited", ...old },
      { id: uuid(803), customerId: 1, note: "New", ...old },
    ];
    snapshot.organizationCommunications = [
      { id: uuid(801), organizationId: snapshot.organizations[0].id, contactId: null, note: "Moved by a merge", ...old },
      { id: uuid(802), organizationId: snapshot.organizations[0].id, contactId: snapshot.contacts[0].id, note: "Before", ...old },
      { id: uuid(804), organizationId: snapshot.organizations[0].id, contactId: null, note: "Gone", ...old },
    ];
    expect(computeChanges(snapshot).changes.map((change) => change.op)).toEqual([
      { kind: "moveCommunication", id: uuid(801), party: "customer:2" },
      { kind: "update", table: "organizationCommunications", id: uuid(802), set: { note: "Edited" }, touchedAt: null },
      { kind: "update", table: "organizationCommunications", id: uuid(802), set: { contactId: null }, touchedAt: null },
      expect.objectContaining({ kind: "addCommunication", party: "customer:1" }),
      { kind: "removeCommunication", id: uuid(804) },
    ]);
  });
});
