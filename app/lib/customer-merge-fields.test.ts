import { describe, expect, it } from "vitest";

import { CustomerMergeError } from "./customer-merge-error";
import {
  compareContacts,
  compareOrganizations,
  planContactMerge,
  planOrganizationMerge,
  type OrganizationMergeState,
} from "./customer-merge-fields";

const account = (overrides: Partial<NonNullable<OrganizationMergeState["customer"]>> = {}) => ({
  id: "acct",
  paymentTerms: null,
  billingAddressId: null,
  billingAddress: null,
  discordId: null,
  notes: null,
  ...overrides,
});

const org = (overrides: Partial<OrganizationMergeState> = {}): OrganizationMergeState => ({
  id: "org",
  name: "Acme",
  kind: "business",
  website: null,
  phone: null,
  primaryContact: null,
  defaultShipping: null,
  customer: account(),
  vendor: null,
  ...overrides,
});

describe("compareOrganizations", () => {
  it("fills blank survivor fields from the merged side", () => {
    const result = compareOrganizations(org(), org({ website: "acme.test" }));
    expect(result.autoFills).toEqual([{ field: "website", label: "Website", value: "acme.test" }]);
    expect(result.conflicts).toEqual([]);
  });

  it("requires an explicit choice when payment terms differ", () => {
    const survivor = org({ customer: account({ paymentTerms: "Net 30" }) });
    const merged = org({ customer: account({ paymentTerms: "Net 15" }) });
    const [conflict] = compareOrganizations(survivor, merged).conflicts;
    expect(conflict).toMatchObject({ field: "customerPaymentTerms", requiresExplicitChoice: true });
    expect(() => planOrganizationMerge(survivor, merged, {})).toThrow(CustomerMergeError);
    expect(planOrganizationMerge(survivor, merged, { customerPaymentTerms: "merged" }).customer).toEqual({
      paymentTerms: "Net 15",
    });
  });

  it("does not compare account fields the survivor lacks: the account moves as is", () => {
    const survivor = org({ customer: null });
    const merged = org({ customer: account({ paymentTerms: "Net 15" }) });
    expect(compareOrganizations(survivor, merged).conflicts).toEqual([]);
    expect(planOrganizationMerge(survivor, merged, {}).customer).toBeNull();
  });

  it("defaults to the business name and kind when an individual joins a business", () => {
    const survivor = org({ name: "Jane Doe", kind: "individual" });
    const merged = org({ name: "Acme", kind: "business" });
    const conflicts = compareOrganizations(survivor, merged).conflicts;
    expect(conflicts.map((c) => [c.field, c.defaultChoice])).toEqual([
      ["name", "merged"],
      ["kind", "merged"],
    ]);
    expect(planOrganizationMerge(survivor, merged, {}).organization).toEqual({
      name: "Acme",
      kind: "business",
    });
    expect(planOrganizationMerge(survivor, merged, { name: "survivor", kind: "survivor" }).organization).toEqual({});
  });

  it("ignores case and spacing differences in names", () => {
    expect(compareOrganizations(org({ name: "ACME  Inc" }), org({ name: "acme inc" })).conflicts).toEqual([]);
  });

  it("lets staff keep the merged side's primary Contact and shipping address", () => {
    const survivor = org({
      primaryContact: { id: "c1", label: "Jane" },
      defaultShipping: { id: "a1", address: { line1: "1 Main" } },
    });
    const merged = org({
      primaryContact: { id: "c2", label: "Bob" },
      defaultShipping: { id: "a2", address: { line1: "2 Dock" } },
    });
    expect(compareOrganizations(survivor, merged).conflicts.map((c) => c.field)).toEqual([
      "primaryContact",
      "defaultShippingAddress",
    ]);
    const plan = planOrganizationMerge(survivor, merged, {
      primaryContact: "merged",
      defaultShippingAddress: "merged",
    });
    expect(plan.primaryContactId).toBe("c2");
    expect(plan.defaultShippingAddressId).toBe("a2");
  });

  it("compares vendor-only fields when both sides are Vendors", () => {
    const survivor = org({ customer: null, vendor: account({ discordId: "1" }) });
    const merged = org({ customer: null, vendor: account({ discordId: "2", notes: "fast" }) });
    const result = compareOrganizations(survivor, merged);
    expect(result.conflicts.map((c) => c.field)).toEqual(["vendorDiscordId"]);
    expect(result.autoFills.map((f) => f.field)).toEqual(["vendorNotes"]);
    expect(planOrganizationMerge(survivor, merged, {}).vendor).toEqual({ notes: "fast" });
  });
});

describe("contact merge fields", () => {
  const contact = { id: "c", name: "Jane", title: null, email: "jane@acme.test", phone: null };

  it("treats emails that normalize the same as equal", () => {
    expect(compareContacts(contact, { ...contact, email: " Jane@ACME.test " }).conflicts).toEqual([]);
  });

  it("applies chosen and auto-filled fields", () => {
    const merged = { ...contact, id: "d", name: "Jane Doe", phone: "555" };
    expect(planContactMerge(contact, merged, { name: "merged" })).toEqual({ name: "Jane Doe", phone: "555" });
    expect(planContactMerge(contact, merged, {})).toEqual({ phone: "555" });
  });
});
