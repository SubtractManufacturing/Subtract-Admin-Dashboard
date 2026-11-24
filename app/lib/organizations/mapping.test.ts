import { describe, expect, it } from "vitest";

import { FREE_EMAIL_DOMAINS } from "./free-email-domains";
import {
  BUSINESS_WORDS,
  REVIEW_FLAGS,
  blankToNull,
  firstNameFromEmail,
  mapLegacyNames,
  mapLegacyParty,
  resultFingerprint,
  reviewFlags,
  reviewSuggestions,
  type LegacyPartyRow,
} from "./mapping";

const createdAt = new Date("2026-01-02T03:04:05.000Z");
const updatedAt = new Date("2026-02-03T04:05:06.000Z");

function party(over: Partial<LegacyPartyRow> = {}): LegacyPartyRow {
  return {
    type: "customer",
    id: 1,
    displayName: "Pat Example",
    companyName: null,
    contactName: null,
    title: null,
    email: null,
    phone: null,
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
    createdAt,
    updatedAt,
    aliasEmails: [],
    ...over,
  };
}

describe("blankToNull", () => {
  it.each([null, undefined, "", "   ", "\t\n", " "])(
    "treats %j as not set",
    (value) => {
      expect(blankToNull(value)).toBeNull();
    },
  );

  it("trims a set value", () => {
    expect(blankToNull("  Acme  ")).toBe("Acme");
  });
});

describe("mapLegacyNames", () => {
  // Every combination of the three name fields being set or blank.
  it.each([
    // display, company, contact → kind, organization, contact
    ["Shown", "Co", "Person", "business", "Co", "Person"],
    ["Shown", "Co", null, "business", "Co", "Shown"],
    ["Shown", null, "Person", "individual", "Shown", "Person"],
    ["Shown", null, null, "individual", "Shown", "Shown"],
    ["", "Co", "Person", "business", "Co", "Person"],
    ["", "Co", null, "business", "Co", null],
    ["", null, "Person", "individual", "", "Person"],
    ["", null, null, "individual", "", null],
  ] as const)(
    "display %j, company %j, contact %j",
    (displayName, companyName, contactName, kind, organizationName, contact) => {
      expect(mapLegacyNames({ displayName, companyName, contactName })).toEqual({
        kind,
        organizationName,
        contactName: contact,
      });
    },
  );

  it("is a business only when the company name is set", () => {
    expect(mapLegacyNames({ displayName: "A", companyName: "   " }).kind).toBe(
      "individual",
    );
    expect(mapLegacyNames({ displayName: "A", companyName: " B " })).toMatchObject({
      kind: "business",
      organizationName: "B",
    });
  });

  it("does not name the Contact after a display name that only repeats the company", () => {
    expect(
      mapLegacyNames({ displayName: " Acme ", companyName: "Acme" }).contactName,
    ).toBeNull();
  });

  it("keeps a contact name that repeats the company (the review list flags it)", () => {
    expect(
      mapLegacyNames({ displayName: "Acme", companyName: "Acme", contactName: "Acme" })
        .contactName,
    ).toBe("Acme");
  });

  it("treats whitespace-only names as blank", () => {
    expect(
      mapLegacyNames({ displayName: "Shown", companyName: " \t", contactName: "\n" }),
    ).toEqual({ kind: "individual", organizationName: "Shown", contactName: "Shown" });
  });

  it("keeps a blank display name as stored when there is nothing else", () => {
    expect(mapLegacyNames({ displayName: "  " }).organizationName).toBe("  ");
  });
});

describe("resultFingerprint", () => {
  it("is the same for the same result and different for any other", () => {
    const base = mapLegacyNames({ displayName: "Shown", companyName: "Co" });
    expect(resultFingerprint(base)).toBe(
      resultFingerprint(mapLegacyNames({ displayName: " Shown ", companyName: "Co " })),
    );
    const others = [
      mapLegacyNames({ displayName: "Shown" }),
      mapLegacyNames({ displayName: "Shown", companyName: "Co2" }),
      mapLegacyNames({ displayName: "Shown", companyName: "Co", contactName: "P" }),
    ];
    for (const other of others) {
      expect(resultFingerprint(other)).not.toBe(resultFingerprint(base));
    }
  });

  it("tells a null Contact from an empty-looking one", () => {
    expect(
      resultFingerprint({ kind: "business", organizationName: "A", contactName: null }),
    ).not.toBe(
      resultFingerprint({ kind: "business", organizationName: "A", contactName: "null" }),
    );
  });
});

describe("mapLegacyParty", () => {
  it("copies a Customer with a company to a business with one Contact", () => {
    const mapped = mapLegacyParty(
      party({
        displayName: "Pat Example",
        companyName: "Example Robotics",
        contactName: "Pat Example",
        title: " Buyer ",
        email: " Pat@Example.test ",
        phone: "555-0100",
        paymentTerms: "Net 30",
      }),
    );
    expect(mapped.organization).toEqual({
      kind: "business",
      name: "Example Robotics",
      isArchived: false,
      createdAt,
    });
    expect(mapped.contact).toEqual({
      name: "Pat Example",
      title: "Buyer",
      email: "Pat@Example.test",
      phone: "555-0100",
      isArchived: false,
      createdAt,
    });
    expect(mapped.account).toEqual({
      type: "customer",
      paymentTerms: "Net 30",
      discordId: null,
      legacyAddress: null,
      notes: null,
      isArchived: false,
      createdAt,
    });
  });

  it("makes blank title, email and phone null", () => {
    const mapped = mapLegacyParty(party({ title: " ", email: "", phone: "\t" }));
    expect(mapped.contact).toMatchObject({ title: null, email: null, phone: null });
  });

  it("keeps the normalized primary email as an alias beside the old aliases", () => {
    const mapped = mapLegacyParty(
      party({
        email: " <Pat@Example.test>. ",
        aliasEmails: ["zed@example.test", "pat@example.test", "old@example.test"],
      }),
    );
    expect(mapped.aliases).toEqual([
      "old@example.test",
      "pat@example.test",
      "zed@example.test",
    ]);
  });

  it("never strips plus-tags or gmail dots from an alias", () => {
    expect(
      mapLegacyParty(party({ email: "First.Last+rfq@gmail.com" })).aliases,
    ).toEqual(["first.last+rfq@gmail.com"]);
  });

  it("has no alias when the email is missing or not an address", () => {
    expect(mapLegacyParty(party({ email: null })).aliases).toEqual([]);
    expect(mapLegacyParty(party({ email: "call me" })).aliases).toEqual([]);
  });

  it("gives a Vendor only its primary email as alias", () => {
    const mapped = mapLegacyParty(
      party({ type: "vendor", email: "Shop@Example.test" }),
    );
    expect(mapped.aliases).toEqual(["shop@example.test"]);
  });

  it("creates an address only when a field other than the country is filled", () => {
    const none = mapLegacyParty(party());
    expect(none.billingAddress).toBeNull();
    expect(none.shippingAddress).toBeNull();

    const whitespace = mapLegacyParty(
      party({ billingAddressLine1: "  ", shippingCity: "\t" }),
    );
    expect(whitespace.billingAddress).toBeNull();
    expect(whitespace.shippingAddress).toBeNull();
  });

  it.each([
    "billingAddressLine1",
    "billingAddressLine2",
    "billingCity",
    "billingState",
    "billingPostalCode",
  ] as const)("creates the billing address when only %s is filled", (field) => {
    const mapped = mapLegacyParty(party({ [field]: "x" }));
    expect(mapped.billingAddress).not.toBeNull();
    expect(mapped.shippingAddress).toBeNull();
  });

  it("labels the addresses and marks the shipping one as default, fields as stored", () => {
    const mapped = mapLegacyParty(
      party({
        billingAddressLine1: " 1 Main St ",
        billingCity: "Springfield",
        billingState: "IL",
        billingPostalCode: "62701",
        billingCountry: "US",
        shippingAddressLine1: "2 Dock Rd",
        shippingAddressLine2: "Bay 4",
        shippingCountry: null,
      }),
    );
    expect(mapped.billingAddress).toEqual({
      label: "Billing",
      line1: " 1 Main St ",
      line2: null,
      city: "Springfield",
      state: "IL",
      postalCode: "62701",
      country: "US",
      isDefaultShipping: false,
    });
    expect(mapped.shippingAddress).toEqual({
      label: "Shipping",
      line1: "2 Dock Rd",
      line2: "Bay 4",
      city: null,
      state: null,
      postalCode: null,
      country: null,
      isDefaultShipping: true,
    });
  });

  it("carries Vendor-only fields on a vendor account and never on a customer account", () => {
    const fields = { discordId: "1234", address: "Old free text", notes: "Titanium" };
    expect(mapLegacyParty(party({ type: "vendor", ...fields })).account).toMatchObject({
      type: "vendor",
      discordId: "1234",
      legacyAddress: "Old free text",
      notes: "Titanium",
    });
    expect(mapLegacyParty(party({ type: "customer", ...fields })).account).toMatchObject({
      type: "customer",
      discordId: null,
      legacyAddress: null,
      notes: null,
    });
  });

  it("carries archived rows over archived", () => {
    const mapped = mapLegacyParty(party({ isArchived: true }));
    expect(mapped.organization.isArchived).toBe(true);
    expect(mapped.contact.isArchived).toBe(true);
    expect(mapped.account.isArchived).toBe(true);
  });

  it("carries a Customer's merge pointer and gives a Vendor none", () => {
    expect(
      mapLegacyParty(party({ mergedIntoCustomerId: 7 })).mergedIntoLegacyCustomerId,
    ).toBe(7);
    expect(
      mapLegacyParty(party({ type: "vendor", mergedIntoCustomerId: 7 }))
        .mergedIntoLegacyCustomerId,
    ).toBeNull();
  });
});

describe("reviewFlags", () => {
  const flags = (row: Parameters<typeof reviewFlags>[0]) => reviewFlags(row);
  const email = "pat@gmail.com";

  it("has nothing to say about a complete row", () => {
    expect(
      flags({ displayName: "Pat", companyName: "Example Co", contactName: "Pat", email }),
    ).toEqual([]);
    expect(flags({ displayName: "Pat Example", email })).toEqual([]);
  });

  it.each([
    "Example Co - Pat",
    "Example Co – Pat",
    "Example Co / Pat",
    "Example Co (Pat)",
    "Pat c/o Example Co",
    "Pat AT Example Co",
    "Pat @ Example Co",
  ])("flags a combined display name: %s", (displayName) => {
    expect(flags({ displayName, email })).toContain("combinedName");
  });

  it("does not flag a hyphenated or slashed name without spaces", () => {
    expect(flags({ displayName: "Smith-Jones A/B", email })).toEqual([]);
  });

  it.each(BUSINESS_WORDS)("flags the business word %s", (word) => {
    expect(flags({ displayName: `Example ${word.toUpperCase()}`, email })).toContain(
      "businessWord",
    );
  });

  it("matches business words as whole words only", () => {
    expect(flags({ displayName: "Vincent Toolan", email })).toEqual([]);
    expect(flags({ displayName: "Caféinc", email })).toEqual([]);
    expect(flags({ displayName: "Example_inc", email })).toEqual([]);
    expect(flags({ displayName: "Example, Inc.", email })).toEqual(["businessWord"]);
  });

  it("flags a business email domain, but not a free mailbox", () => {
    expect(flags({ displayName: "Pat", email: "pat@example-robotics.test" })).toEqual([
      "businessDomain",
    ]);
    for (const domain of FREE_EMAIL_DOMAINS) {
      expect(flags({ displayName: "Pat", email: `Pat@${domain.toUpperCase()}` })).toEqual(
        [],
      );
    }
  });

  it("flags none of the no-company rules once a company is set", () => {
    expect(
      flags({
        displayName: "Example Tools - Pat",
        companyName: "Example Tools",
        contactName: "Pat",
        email: "pat@example-tools.test",
      }),
    ).toEqual([]);
  });

  it("flags a Contact that would be named after the display name", () => {
    expect(flags({ displayName: "Pat", companyName: "Example Co", email })).toEqual([
      "contactFromDisplayName",
    ]);
    expect(flags({ displayName: "", companyName: "Example Co", email })).toEqual([
      "contactFromDisplayName",
    ]);
  });

  it("flags a business with an unnamed Contact", () => {
    expect(
      flags({ displayName: "Example Co ", companyName: " Example Co", email }),
    ).toEqual(["unnamedContact"]);
  });

  it("flags a contact name that repeats the company, whatever the case", () => {
    expect(
      flags({ displayName: "X", companyName: "Example Co", contactName: "EXAMPLE CO", email }),
    ).toEqual(["contactRepeatsCompany"]);
  });

  it("flags a missing or unusable email", () => {
    expect(flags({ displayName: "Pat" })).toEqual(["noEmail"]);
    expect(flags({ displayName: "Pat", email: "  " })).toEqual(["noEmail"]);
    expect(flags({ displayName: "Pat", email: "no at sign" })).toEqual(["noEmail"]);
    expect(flags({ displayName: "Pat", email: "pat@" })).toEqual(["noEmail"]);
  });

  it("lists flags in the order of the precheck query", () => {
    expect(flags({ displayName: "Example Tools - Pat", email: "pat@example.test" })).toEqual(
      ["combinedName", "businessWord", "businessDomain"],
    );
    expect(Object.keys(REVIEW_FLAGS)).toEqual([
      "combinedName",
      "businessWord",
      "businessDomain",
      "contactFromDisplayName",
      "unnamedContact",
      "contactRepeatsCompany",
      "noEmail",
    ]);
  });
});

describe("reviewSuggestions", () => {
  it("offers the display name as the company for a business-looking row", () => {
    expect(
      reviewSuggestions({ displayName: " Example Machining ", email: "x@gmail.com" }),
    ).toEqual([
      {
        id: "display-as-company",
        label: 'Company "Example Machining"',
        fields: { companyName: "Example Machining" },
      },
    ]);
    expect(
      reviewSuggestions({ displayName: "Pat", email: "pat@example-robotics.test" }).map(
        (suggestion) => suggestion.id,
      ),
    ).toEqual(["display-as-company"]);
  });

  it("splits a combined name into company and person, both ways round", () => {
    const suggestions = reviewSuggestions({
      displayName: "Example Co - Pat Example",
      email: "x@gmail.com",
    });
    expect(suggestions.map((suggestion) => [suggestion.id, suggestion.fields])).toEqual([
      ["split", { companyName: "Example Co", contactName: "Pat Example" }],
      ["split-swapped", { companyName: "Pat Example", contactName: "Example Co" }],
      ["display-as-company", { companyName: "Example Co - Pat Example" }],
    ]);
  });

  it("puts the side with a business word first as the company", () => {
    expect(
      reviewSuggestions({ displayName: "Pat Example - Example Tools", email: "x@gmail.com" })[0]
        .fields,
    ).toEqual({ companyName: "Example Tools", contactName: "Pat Example" });
  });

  it.each([
    ["Pat Example c/o Example Co", "Example Co", "Pat Example"],
    ["Pat Example at Example Co", "Example Co", "Pat Example"],
    ["Pat Example @ Example Co", "Example Co", "Pat Example"],
    ["Example Co (Pat Example)", "Example Co", "Pat Example"],
    ["Example Co / Pat Example", "Example Co", "Pat Example"],
  ])("splits %s", (displayName, companyName, contactName) => {
    expect(reviewSuggestions({ displayName, email: "x@gmail.com" })[0].fields).toEqual({
      companyName,
      contactName,
    });
  });

  it("offers nothing when the company is already set or the row looks fine", () => {
    expect(
      reviewSuggestions({ displayName: "Example Tools - Pat", companyName: "Example Tools" }),
    ).toEqual([]);
    expect(reviewSuggestions({ displayName: "Pat Example", email: "x@gmail.com" })).toEqual([]);
    expect(reviewSuggestions({ displayName: " " })).toEqual([]);
  });

  it("never offers an empty half", () => {
    expect(
      reviewSuggestions({ displayName: "Example Co (", email: "x@gmail.com" }).map(
        (suggestion) => suggestion.id,
      ),
    ).toEqual([]);
  });
});

describe("firstNameFromEmail", () => {
  it.each([
    ["pat.example@example.test", "Pat"],
    ["PAT_EXAMPLE@example.test", "Pat"],
    ["pat-example+rfq@example.test", "Pat"],
    ["pat42@example.test", "Pat"],
    ["  <Pat@Example.test>  ", "Pat"],
  ])("reads %s as %s", (email, name) => {
    expect(firstNameFromEmail(email)).toBe(name);
  });

  it.each([null, "", "not an email", "sales@example.test", "info@example.test", "p@example.test", "42@example.test"])(
    "has no hint for %j",
    (email) => {
      expect(firstNameFromEmail(email)).toBeNull();
    },
  );
});
