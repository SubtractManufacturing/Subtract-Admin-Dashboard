import { describe, expect, it } from "vitest";

import {
  businessDomainFromEmail,
  companyIdentityFor,
  matchCompany,
  isQuoteSendConfirmed,
  normalizeCompanyName,
  RFQ_STATUS_BY_QUOTE_STATUS,
  splitContactName,
  toTwentyAmount,
  toTwentyPhone,
} from "./matching";

const customer = {
  companyName: null,
  displayName: "",
  contactName: null,
  email: null,
};

describe("RFQ status mapping", () => {
  it("does not treat an automatic expiry as a lost sale", () => {
    expect(RFQ_STATUS_BY_QUOTE_STATUS.Expired).toBeUndefined();
  });

  it("maps the statuses with a real ERP event", () => {
    expect(RFQ_STATUS_BY_QUOTE_STATUS).toEqual({
      RFQ: "NEW_RFQ",
      Draft: "QUOTING",
      Sent: "QUOTE_SENT",
      Accepted: "WON",
      Rejected: "LOST",
      Dropped: "LOST",
    });
  });
});

describe("normalizeCompanyName", () => {
  it("ignores case, punctuation, spacing and legal suffixes", () => {
    expect(normalizeCompanyName("Tri-Mark, LLC")).toBe("trimark");
    expect(normalizeCompanyName("tri mark")).toBe("trimark");
    expect(normalizeCompanyName("TRIMARK Inc.")).toBe("trimark");
  });

  it("keeps a name made only of suffix words", () => {
    expect(normalizeCompanyName("The Company")).toBe("the");
    expect(normalizeCompanyName("Company")).toBe("company");
  });
});

describe("businessDomainFromEmail", () => {
  it("returns company domains and refuses free mail", () => {
    expect(businessDomainFromEmail("Bob@Acme.com")).toBe("acme.com");
    expect(businessDomainFromEmail("trimarkperformance@gmail.com")).toBeNull();
    expect(businessDomainFromEmail("someone@outlook.com")).toBeNull();
    expect(businessDomainFromEmail(null)).toBeNull();
  });
});

describe("companyIdentityFor", () => {
  it("prefers the explicit company name", () => {
    expect(
      companyIdentityFor({ ...customer, companyName: " Acme ", displayName: "Ignored" }),
    ).toEqual({ name: "Acme", weakName: null, domain: null });
  });

  it("takes the company half of an RFQ display name", () => {
    expect(
      companyIdentityFor({
        ...customer,
        displayName: "Britzman Enterprises - Mark Jones",
        contactName: "Mark Jones",
      }).name,
    ).toBe("Britzman Enterprises");
  });

  it("uses a manual display name that names a business", () => {
    expect(
      companyIdentityFor({ ...customer, displayName: "Britzman Enterprises" }).name,
    ).toBe("Britzman Enterprises");
  });

  it("will not create a company from a display name that may be a person", () => {
    expect(companyIdentityFor({ ...customer, displayName: "Mark Jones" })).toEqual({
      name: null,
      weakName: "Mark Jones",
      domain: null,
    });
  });

  it("sees no company when the display name is the contact", () => {
    const identity = companyIdentityFor({
      ...customer,
      displayName: "Mark Jones",
      contactName: "Mark Jones",
      email: "mark@gmail.com",
    });
    expect(identity).toEqual({ name: null, weakName: null, domain: null });
  });
});

describe("matchCompany", () => {
  const acme = { id: "acme", name: "Acme Manufacturing", domain: "acme.com" };
  const domainNamed = { id: "dom", name: "widgetco.com", domain: null };
  const noFree = { name: null, weakName: null, domain: null };

  it("matches an explicit name first", () => {
    expect(
      matchCompany([acme], { ...noFree, name: "ACME Manufacturing, Inc." }),
    ).toEqual({ kind: "matched", id: "acme" });
  });

  it("reconciles a blank company name against an imported domain account", () => {
    expect(matchCompany([acme], { ...noFree, domain: "acme.com" })).toEqual({
      kind: "matched",
      id: "acme",
    });
    expect(matchCompany([domainNamed], { ...noFree, domain: "widgetco.com" })).toEqual({
      kind: "matched",
      id: "dom",
    });
  });

  it("accepts a domain account when the stated name is compatible", () => {
    expect(
      matchCompany([acme], { ...noFree, name: "Acme Mfg", domain: "acme.com" }),
    ).toEqual({ kind: "matched", id: "acme" });
  });

  it("keeps a differently named company off another company's domain", () => {
    expect(
      matchCompany(
        [{ id: "tm", name: "Tri-Mark", domain: "trimark.com" }],
        { ...noFree, name: "Britzman Enterprises", domain: "trimark.com" },
      ),
    ).toEqual({ kind: "none", domainTaken: true });
  });

  it("still fills in a placeholder account when the name is unrelated to the domain", () => {
    expect(
      matchCompany([{ id: "z", name: "zap.com", domain: null }], {
        ...noFree,
        name: "Zenith Aerospace",
        domain: "zap.com",
      }),
    ).toEqual({ kind: "matched", id: "z" });
  });

  it("does not link a domain-named company that records a different domain", () => {
    const other = { id: "other", name: "Acme", domain: "other.com" };
    expect(matchCompany([other], { ...noFree, domain: "acme.com" })).toEqual({
      kind: "none",
      domainTaken: false,
    });
    expect(
      matchCompany([other], { ...noFree, name: "Acme Robotics", domain: "acme.com" }),
    ).toEqual({ kind: "none", domainTaken: false });
  });

  it("reports ambiguity instead of guessing", () => {
    const twin = { id: "acme2", name: "ACME Manufacturing LLC", domain: null };
    expect(matchCompany([acme, twin], { ...noFree, name: "Acme Manufacturing" })).toEqual(
      { kind: "ambiguous", candidates: [acme, twin] },
    );
  });

  it("asks rather than linking the same name on a different domain", () => {
    const other = { id: "other", name: "Acme", domain: "other.com" };
    expect(matchCompany([other], { ...noFree, name: "Acme", domain: "acme.com" })).toEqual({
      kind: "ambiguous",
      candidates: [other],
    });
  });

  it("accepts a same-name company with no domain recorded", () => {
    const bare = { id: "bare", name: "Acme", domain: null };
    expect(matchCompany([bare], { ...noFree, name: "Acme", domain: "acme.com" })).toEqual({
      kind: "matched",
      id: "bare",
    });
  });

  it("settles a duplicate name with the business domain", () => {
    const twin = { id: "acme2", name: "ACME Manufacturing LLC", domain: null };
    expect(
      matchCompany([acme, twin], {
        ...noFree,
        name: "Acme Manufacturing",
        domain: "acme.com",
      }),
    ).toEqual({ kind: "matched", id: "acme" });
  });

  it("never matches a person's name to a free-mail account", () => {
    expect(
      matchCompany([{ id: "g", name: "gmail.com", domain: "gmail.com" }], noFree),
    ).toEqual({ kind: "none", domainTaken: false });
  });
});

describe("isQuoteSendConfirmed", () => {
  const before = new Date("2026-11-03T10:00:00.000Z");
  const after = new Date("2026-11-03T11:00:00.000Z");

  it("accepts delivery, and quotes that never had an email", () => {
    expect(isQuoteSendConfirmed({ status: "sent", updatedAt: after, quoteSentAt: before })).toBe(true);
    expect(isQuoteSendConfirmed({ status: null, updatedAt: null, quoteSentAt: after })).toBe(true);
  });

  it.each(["pending_approval", "queued", "sending"])("holds a %s email", (status) => {
    expect(isQuoteSendConfirmed({ status, updatedAt: before, quoteSentAt: after })).toBe(false);
  });

  it.each(["failed", "bounced", "rejected"])("counts a %s email only if staff marked sent later", (status) => {
    expect(isQuoteSendConfirmed({ status, updatedAt: before, quoteSentAt: after })).toBe(true);
    expect(isQuoteSendConfirmed({ status, updatedAt: after, quoteSentAt: before })).toBe(false);
    expect(isQuoteSendConfirmed({ status, updatedAt: after, quoteSentAt: null })).toBe(false);
  });
});

describe("toTwentyPhone", () => {
  it("normalizes US numbers from free text", () => {
    const expected = {
      primaryPhoneNumber: "5551234567",
      primaryPhoneCountryCode: "US",
      primaryPhoneCallingCode: "+1",
    };
    expect(toTwentyPhone("(555) 123-4567")).toEqual(expected);
    expect(toTwentyPhone("+1 555.123.4567")).toEqual(expected);
    expect(toTwentyPhone("1-555-123-4567 ext. 22")).toEqual(expected);
    expect(toTwentyPhone("555-123-4567 x22")).toEqual(expected);
  });

  it("keeps international numbers in E.164", () => {
    expect(toTwentyPhone("+44 20 7946 0958")).toEqual({
      primaryPhoneNumber: "+442079460958",
    });
  });

  it("omits anything that would make Twenty reject the record", () => {
    expect(toTwentyPhone("call the front desk")).toBeNull();
    expect(toTwentyPhone("12345")).toBeNull();
    expect(toTwentyPhone(null)).toBeNull();
  });
});

describe("value helpers", () => {
  it("splits names on the last space", () => {
    expect(splitContactName("Mary Ann Smith")).toEqual({
      firstName: "Mary Ann",
      lastName: "Smith",
    });
    expect(splitContactName("Mark")).toEqual({ firstName: "Mark", lastName: "" });
    expect(splitContactName("  ")).toBeNull();
  });

  it("converts totals to micros and leaves unpriced quotes unset", () => {
    expect(toTwentyAmount("1234.56")).toEqual({
      amountMicros: 1_234_560_000,
      currencyCode: "USD",
    });
    expect(toTwentyAmount("0.00")).toBeNull();
    expect(toTwentyAmount(null)).toBeNull();
  });
});
