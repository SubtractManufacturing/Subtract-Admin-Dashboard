import { describe, expect, it } from "vitest";

import { searchCustomers, type CustomerSearchRecord } from "./customer-search";

const record = (
  id: number,
  displayName: string,
  overrides: Partial<CustomerSearchRecord> = {},
): CustomerSearchRecord => ({
  id,
  displayName,
  companyName: null,
  contactName: null,
  email: null,
  phone: null,
  ...overrides,
});

const customers = [
  record(1, "Acme Widgets", { companyName: "Acme Inc", email: "orders@acme.com", phone: "(555) 123-4567" }),
  record(2, "Dana Rivera", { companyName: "Rivera Machining", contactName: "Dana Rivera", email: "dana@rivera.io" }),
  record(3, "Bolt Brothers", { contactName: "Acme Liaison", phone: "+1 555 987 6543" }),
];

const ids = (query: string) => searchCustomers(customers, query).results.map((c) => c.id);

describe("searchCustomers", () => {
  it("lists everyone, in order, for an empty search", () => {
    expect(ids("   ")).toEqual([1, 2, 3]);
  });

  it("finds Customers by name, company, contact and email", () => {
    expect(ids("rivera")).toEqual([2]);
    expect(ids("machining")).toEqual([2]);
    expect(ids("liaison")).toEqual([3]);
    expect(ids("orders@acme")).toEqual([1]);
  });

  it("ignores case and requires every word to match", () => {
    expect(ids("DANA machining")).toEqual([2]);
    expect(ids("dana acme")).toEqual([]);
  });

  it("matches phone numbers by digits regardless of formatting", () => {
    expect(ids("555-123")).toEqual([1]);
    expect(ids("5559876543")).toEqual([3]);
    expect(ids("(555)")).toEqual([1, 3]);
  });

  it("ranks names that start with the search first", () => {
    expect(ids("acme")).toEqual([1, 3]);
    expect(ids("bolt acme")).toEqual([3]);
  });

  it("caps the results but reports the full match count", () => {
    const many = Array.from({ length: 80 }, (_, i) => record(i + 1, `Shop ${i}`));

    const { results, total } = searchCustomers(many, "shop", 50);

    expect(results).toHaveLength(50);
    expect(total).toBe(80);
  });
});
