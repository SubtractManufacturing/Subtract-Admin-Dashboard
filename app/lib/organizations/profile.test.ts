import { describe, expect, it } from "vitest";

import {
  addressFromProfile,
  addressIsFilled,
  emailDomain,
  formatAddressLines,
  organizationFieldsFromInput,
  organizationFromLegacy,
} from "./profile";

describe("organizationFromLegacy", () => {
  it("makes a business named after the company, keeping the person as Contact", () => {
    expect(
      organizationFromLegacy({ displayName: "Jane Doe", companyName: "Acme", contactName: null }),
    ).toEqual({ kind: "business", name: "Acme", contactName: "Jane Doe" });
  });

  it("makes an individual named after the display name", () => {
    expect(organizationFromLegacy({ displayName: " Sam ", companyName: "  " })).toEqual({
      kind: "individual",
      name: "Sam",
      contactName: "Sam",
    });
  });

  it("prefers the explicit contact name", () => {
    expect(
      organizationFromLegacy({ displayName: "Acme", companyName: "Acme", contactName: "Bo" }),
    ).toMatchObject({ contactName: "Bo" });
  });

  it("leaves the Contact unnamed when the display name only repeats the company", () => {
    expect(organizationFromLegacy({ displayName: "Acme", companyName: "Acme" })).toMatchObject({
      contactName: null,
    });
  });
});

describe("organizationFieldsFromInput", () => {
  it("uses explicit name and kind", () => {
    expect(organizationFieldsFromInput({ name: "Acme", kind: "individual" })).toEqual({
      name: "Acme",
      kind: "individual",
    });
  });

  it("maps legacy display and company names", () => {
    expect(organizationFieldsFromInput({ displayName: "Jane", companyName: "Acme" })).toEqual({
      name: "Acme",
      kind: "business",
    });
    expect(organizationFieldsFromInput({ displayName: "Jane", companyName: null })).toEqual({
      name: "Jane",
      kind: "individual",
    });
  });

  it("keeps the current kind on a legacy rename without a company", () => {
    expect(
      organizationFieldsFromInput({ displayName: "Acme Two" }, { name: "Acme", kind: "business" }),
    ).toEqual({ name: "Acme Two", kind: "business" });
  });

  it("keeps the current kind when only the name changes", () => {
    expect(
      organizationFieldsFromInput({ name: "New" }, { name: "Old", kind: "individual" }),
    ).toEqual({ name: "New", kind: "individual" });
  });

  it("returns undefined when the write does not touch the Organization", () => {
    expect(organizationFieldsFromInput({ email: "a@b.co" })).toBeUndefined();
    expect(organizationFieldsFromInput({ name: "  " })).toBeUndefined();
  });
});

describe("address helpers", () => {
  it("reads only the touched flat columns", () => {
    expect(addressFromProfile({ billingCity: " Springfield ", billingState: "" }, "billing")).toEqual({
      city: "Springfield",
      state: null,
    });
    expect(addressFromProfile({ billingCity: "x" }, "shipping")).toBeUndefined();
  });

  it("does not count the country alone as filled", () => {
    expect(addressIsFilled({ country: "US" })).toBe(false);
    expect(addressIsFilled({ postalCode: "62701", country: "US" })).toBe(true);
  });

  it("formats an address on one line", () => {
    expect(
      formatAddressLines({ line1: "1 Main", city: "Springfield", state: "IL", postalCode: "62701", country: "US" }),
    ).toBe("1 Main, Springfield, IL 62701, US");
  });
});

describe("emailDomain", () => {
  it("lowercases the domain", () => {
    expect(emailDomain("Jane@Acme.COM")).toBe("acme.com");
  });
  it("rejects values without a dotted domain", () => {
    expect(emailDomain("jane")).toBeNull();
    expect(emailDomain("jane@localhost")).toBeNull();
  });
});

describe("profileInputFromForm", () => {
  it("returns only the posted fields", async () => {
    const { profileInputFromForm } = await import("./profile");
    const form = new FormData();
    form.set("name", " Acme ");
    form.set("kind", "individual");
    form.set("billingCity", "");
    form.set("displayName", "ignored");
    expect(profileInputFromForm(form)).toEqual({ name: "Acme", kind: "individual", billingCity: null });
  });
});
