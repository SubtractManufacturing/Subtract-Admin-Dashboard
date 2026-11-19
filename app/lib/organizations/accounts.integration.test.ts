/**
 * Integration tests: Customers and Vendors as accounts on Organizations
 * (ADR-0013) — profile writes, Contacts, addresses, archive and lookups.
 *
 * Requires DATABASE_URL pointing at a disposable database synced with db:push.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { resolveExistingCustomer, resolveExistingVendor } from "../bulk-import";
import { getCustomers, updateCustomer } from "../customers";
import { db } from "../db";
import { accounts, contactEmailAliases, eventLogs, organizations } from "../db/schema";
import {
  accountIdForLegacyId,
  addAddress,
  addContact,
  archiveAccount,
  archiveAddress,
  listOrganizationAddresses,
  listOrganizationContacts,
  loadAccountRecord,
  removeContact,
  setBillingAddress,
  setPrimaryContact,
  updateAccountProfile,
} from "./accounts.server";
import { createTestCustomer, createTestVendor, deleteTestOrganizations } from "~/test/seed-organizations";

const tag = randomUUID().slice(0, 8);
const orgIds: string[] = [];

async function customer(name: string, extra: Parameters<typeof createTestCustomer>[0] = {}) {
  const record = await createTestCustomer({ name: `${name} ${tag}`, kind: "business", ...extra });
  orgIds.push(record.organizationId);
  return record;
}

afterAll(async () => {
  await deleteTestOrganizations(orgIds);
});

describe("account profile writes", () => {
  it("splits a flat profile across Organization, primary Contact, billing and default shipping", async () => {
    const created = await customer("Split", {
      contactName: "Jane",
      email: "Jane@Split.example",
      phone: "555",
      billingAddressLine1: "1 Bill",
      shippingAddressLine1: "2 Ship",
      paymentTerms: "Net 30",
    });
    expect(created).toMatchObject({
      kind: "business",
      companyName: `Split ${tag}`,
      contactName: "Jane",
      email: "Jane@Split.example",
      billingAddressLine1: "1 Bill",
      shippingAddressLine1: "2 Ship",
      paymentTerms: "Net 30",
    });
    const aliases = await db
      .select()
      .from(contactEmailAliases)
      .where(eq(contactEmailAliases.contactId, created.primaryContactId!));
    expect(aliases.map((alias) => alias.email)).toEqual(["jane@split.example"]);
    const list = await listOrganizationAddresses(created.organizationId);
    expect(list.map((a) => [a.label, a.isDefaultShipping])).toEqual([
      ["Shipping", true],
      ["Billing", false],
    ]);
  });

  it("changes only the fields a write names", async () => {
    const created = await customer("Partial", { contactName: "Keep Me", paymentTerms: "Net 15" });
    const updated = await updateAccountProfile("customer", created.id, { email: "new@partial.example" });
    expect(updated).toMatchObject({ contactName: "Keep Me", paymentTerms: "Net 15", email: "new@partial.example" });
    const aliases = await db
      .select()
      .from(contactEmailAliases)
      .where(eq(contactEmailAliases.contactId, created.primaryContactId!));
    expect(aliases.map((alias) => alias.email)).toContain("new@partial.example");
  });

  it("writes Stripe checkout addresses to the account's billing address and the default shipping address", async () => {
    const created = await customer("Checkout");
    await updateCustomer(
      created.id,
      {
        billingAddressLine1: "10 Paid Ave",
        billingCity: "Payville",
        shippingAddressLine1: "20 Dock St",
        shippingCity: "Shipton",
        phone: "+15550199",
      },
      { checkoutAddressImport: { quoteId: 1 } },
    );
    const after = await loadAccountRecord("customer", created.id);
    expect(after).toMatchObject({
      billingAddressLine1: "10 Paid Ave",
      shippingAddressLine1: "20 Dock St",
      phone: "+15550199",
    });
    const [event] = await db.select().from(eventLogs).where(eq(eventLogs.entityId, created.id));
    expect(event.eventType).toBe("customer_checkout_addresses_imported");
  });
});

describe("Contacts and addresses", () => {
  it("adds Contacts, moves the primary flag, and refuses to remove the only Contact", async () => {
    const created = await customer("People", { contactName: "First" });
    const second = await addContact(created.organizationId, { name: "Second", role: "Engineering" });
    await setPrimaryContact(created.organizationId, second);
    expect((await loadAccountRecord("customer", created.id))?.contactName).toBe("Second");
    await removeContact(created.organizationId, second);
    const remaining = await listOrganizationContacts(created.organizationId);
    expect(remaining.map((c) => [c.name, c.isPrimary])).toEqual([["First", true]]);
    await expect(removeContact(created.organizationId, remaining[0].id)).rejects.toMatchObject({ status: 409 });
  });

  it("keeps one default shipping address and will not archive the billing address", async () => {
    const created = await customer("Places", { shippingAddressLine1: "Old Dock" });
    const plant = await addAddress(created.organizationId, { label: "Plant", line1: "5 Plant" }, { makeDefaultShipping: true });
    const defaults = (await listOrganizationAddresses(created.organizationId)).filter((a) => a.isDefaultShipping);
    expect(defaults.map((a) => a.id)).toEqual([plant]);
    await setBillingAddress(created.id, plant);
    expect((await loadAccountRecord("customer", created.id))?.billingAddressLine1).toBe("5 Plant");
    await expect(archiveAddress(created.organizationId, plant)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a Contact or address that belongs to another Organization", async () => {
    const mine = await customer("Mine");
    const theirs = await customer("Theirs", { contactName: "Not yours" });
    await expect(setPrimaryContact(mine.organizationId, theirs.primaryContactId!)).rejects.toMatchObject({ status: 404 });
  });
});

describe("archive and roles", () => {
  it("archives the Organization only when its last active account goes", async () => {
    const created = await customer("Both");
    const vendor = await createTestVendor({}, { organizationId: created.organizationId });
    await archiveAccount(created.id);
    let [org] = await db.select().from(organizations).where(eq(organizations.id, created.organizationId));
    expect(org.isArchived).toBe(false);
    expect((await getCustomers()).some((c) => c.id === created.id)).toBe(false);
    await archiveAccount(vendor.id);
    [org] = await db.select().from(organizations).where(eq(organizations.id, created.organizationId));
    expect(org.isArchived).toBe(true);
  });

  it("refuses a second account of the same type on one Organization", async () => {
    const created = await customer("Once");
    await expect(createTestCustomer({}, { organizationId: created.organizationId })).rejects.toMatchObject({ status: 409 });
  });

  it("finds the account a legacy integer id became", async () => {
    const created = await customer("Legacy");
    const legacyId = 900000 + Math.floor(Math.random() * 99999);
    await db.update(accounts).set({ legacyCustomerId: legacyId }).where(eq(accounts.id, created.id));
    expect(await accountIdForLegacyId("customer", legacyId)).toBe(created.id);
    expect(await accountIdForLegacyId("vendor", legacyId)).toBeNull();
  });
});

describe("bulk import matching", () => {
  it("matches a row by any Contact email, then by the Organization name it maps to", async () => {
    const created = await customer("Importer", { email: `orders-${tag}@importer.example` });
    expect(await resolveExistingCustomer(` ORDERS-${tag}@importer.example `, "Anything")).toEqual({ id: created.id });
    expect(await resolveExistingCustomer(null, "Jane", `importer ${tag}`)).toEqual({ id: created.id });
    expect(await resolveExistingVendor(`orders-${tag}@importer.example`, "Anything")).toBeNull();
  });
});
