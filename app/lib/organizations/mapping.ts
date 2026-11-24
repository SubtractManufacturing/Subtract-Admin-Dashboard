/**
 * The mapping from an old Customer or Vendor row to its Organization, primary
 * Contact, account and addresses (ADR-0013 "Backfill: one row in, one row
 * out", ADR-0014 "One mapping, three users").
 *
 * This module is the single definition of that mapping. Sync, Check and the
 * review list all call it, and the review list also runs it in the browser, so
 * it must stay pure: no database, no I/O, no server-only imports.
 *
 * `scripts/sql/organizations-precheck.sql` repeats the name rules and the
 * flags as a read-only query; `review.serial.integration.test.ts` runs that
 * file and fails when it and this module disagree.
 */
import { normalizeEmail } from "../email-normalize";
import { FREE_EMAIL_DOMAINS } from "./free-email-domains";

export type LegacyType = "customer" | "vendor";
export type OrganizationKindValue = "business" | "individual";

/** Empty and whitespace-only values count as "not set". */
export const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
};

// ---------------------------------------------------------------------------
// Names: what the review list shows
// ---------------------------------------------------------------------------

export type LegacyNameFields = {
  displayName: string | null | undefined;
  companyName?: string | null;
  contactName?: string | null;
};

export type MappedNames = {
  kind: OrganizationKindValue;
  organizationName: string;
  contactName: string | null;
};

/**
 * - `business` when `company_name` is set, otherwise `individual`.
 * - The Organization is named after `company_name`, falling back to
 *   `display_name`.
 * - The Contact is named after `contact_name`, falling back to `display_name`
 *   unless that only repeats the company.
 */
export function mapLegacyNames(row: LegacyNameFields): MappedNames {
  const company = blankToNull(row.companyName);
  const person = blankToNull(row.contactName);
  const shown = blankToNull(row.displayName);
  return {
    kind: company ? "business" : "individual",
    // `display_name` is NOT NULL but may be blank; the Organization then
    // keeps whatever the column holds, as there is nothing else to name it.
    organizationName: company ?? shown ?? row.displayName ?? "",
    contactName:
      person ?? (company === null || shown !== company ? shown : null),
  };
}

/**
 * What a reviewed mark remembers: the result the reviewer looked at. The mark
 * stops counting when the row maps to anything else. Kept readable (not a
 * hash) so a stored mark can be inspected.
 */
export function resultFingerprint(names: MappedNames): string {
  return JSON.stringify([names.kind, names.organizationName, names.contactName]);
}

// ---------------------------------------------------------------------------
// The whole record: what Sync writes and Check compares
// ---------------------------------------------------------------------------

/** An old `customers` or `vendors` row, with its `customer_email_aliases`. */
export type LegacyPartyRow = {
  type: LegacyType;
  id: number;
  displayName: string;
  companyName: string | null;
  contactName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingPostalCode: string | null;
  billingCountry: string | null;
  shippingAddressLine1: string | null;
  shippingAddressLine2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingPostalCode: string | null;
  shippingCountry: string | null;
  paymentTerms: string | null;
  /** Vendors only: `vendors.address`, `vendors.notes`, `vendors.discord_id`. */
  address?: string | null;
  notes?: string | null;
  discordId?: string | null;
  /** Customers only. */
  mergedIntoCustomerId?: number | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** `customer_email_aliases.email` for this Customer, as stored. Empty for Vendors. */
  aliasEmails: readonly string[];
};

export type AddressRole = "billing" | "shipping";

export type MappedAddress = {
  label: string;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  isDefaultShipping: boolean;
};

export type MappedParty = {
  organization: {
    kind: OrganizationKindValue;
    name: string;
    isArchived: boolean;
    createdAt: Date;
  };
  contact: {
    name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    isArchived: boolean;
    createdAt: Date;
  };
  /** Every email the Contact is known by, sorted: the old aliases plus the normalized primary email. */
  aliases: string[];
  account: {
    type: LegacyType;
    paymentTerms: string | null;
    discordId: string | null;
    legacyAddress: string | null;
    notes: string | null;
    isArchived: boolean;
    createdAt: Date;
  };
  billingAddress: MappedAddress | null;
  shippingAddress: MappedAddress | null;
  /** Customers only: the old Customer this one was merged into. */
  mergedIntoLegacyCustomerId: number | null;
};

export const ADDRESS_LABELS: Record<AddressRole, string> = {
  billing: "Billing",
  shipping: "Shipping",
};

/**
 * An address exists only when a field other than the country is filled:
 * `billing_country` and `shipping_country` default to "US" on every row.
 * The fields are copied as stored.
 */
function mapAddress(
  role: AddressRole,
  fields: Omit<MappedAddress, "label" | "isDefaultShipping">,
): MappedAddress | null {
  const filled = [
    fields.line1,
    fields.line2,
    fields.city,
    fields.state,
    fields.postalCode,
  ].some((value) => blankToNull(value) !== null);
  if (!filled) return null;
  return {
    label: ADDRESS_LABELS[role],
    ...fields,
    isDefaultShipping: role === "shipping",
  };
}

export function mapLegacyParty(row: LegacyPartyRow): MappedParty {
  const names = mapLegacyNames(row);
  const isVendor = row.type === "vendor";

  const aliases = new Set<string>(row.aliasEmails);
  const primary = normalizeEmail(row.email);
  if (primary) aliases.add(primary);

  return {
    organization: {
      kind: names.kind,
      name: names.organizationName,
      isArchived: row.isArchived,
      createdAt: row.createdAt,
    },
    contact: {
      name: names.contactName,
      title: blankToNull(row.title),
      email: blankToNull(row.email),
      phone: blankToNull(row.phone),
      isArchived: row.isArchived,
      createdAt: row.createdAt,
    },
    aliases: [...aliases].sort(),
    account: {
      type: row.type,
      paymentTerms: row.paymentTerms,
      discordId: isVendor ? (row.discordId ?? null) : null,
      legacyAddress: isVendor ? (row.address ?? null) : null,
      notes: isVendor ? (row.notes ?? null) : null,
      isArchived: row.isArchived,
      createdAt: row.createdAt,
    },
    billingAddress: mapAddress("billing", {
      line1: row.billingAddressLine1,
      line2: row.billingAddressLine2,
      city: row.billingCity,
      state: row.billingState,
      postalCode: row.billingPostalCode,
      country: row.billingCountry,
    }),
    shippingAddress: mapAddress("shipping", {
      line1: row.shippingAddressLine1,
      line2: row.shippingAddressLine2,
      city: row.shippingCity,
      state: row.shippingState,
      postalCode: row.shippingPostalCode,
      country: row.shippingCountry,
    }),
    mergedIntoLegacyCustomerId:
      row.type === "customer" ? (row.mergedIntoCustomerId ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Review flags
// ---------------------------------------------------------------------------

export type ReviewRow = LegacyNameFields & { email?: string | null };

/**
 * Rows that look wrong. Order and wording are those of
 * `scripts/sql/organizations-precheck.sql`.
 */
export const REVIEW_FLAGS = {
  combinedName: "no company, but the display name looks like company + person",
  businessWord: "no company, but the display name reads like a business",
  businessDomain: "no company, but a business email domain",
  contactFromDisplayName: "the Contact would be named after the display name",
  unnamedContact: "business with an unnamed Contact",
  contactRepeatsCompany: "contact name repeats the company",
  noEmail: "no email",
} as const;

export type ReviewFlag = keyof typeof REVIEW_FLAGS;

const COMBINED_NAME_SEPARATORS = [" - ", " – ", " / ", "(", " c/o ", " at ", " @ "] as const;
const COMBINED_NAME = /( - | – | \/ |\(| c\/o | at | @ )/i;

export const BUSINESS_WORDS = [
  "inc",
  "llc",
  "ltd",
  "corp",
  "mfg",
  "manufacturing",
  "machine",
  "machining",
  "tool",
  "tools",
  "engineering",
  "industries",
  "technologies",
  "tech",
  "robotics",
  "design",
  "products",
  "solutions",
  "enterprises",
  "defense",
  "welding",
  "ventures",
  "fabrication",
  "precision",
] as const;

// Whole words only. Postgres `\m` and `\M` treat letters, digits and "_" in
// any script as word characters, which JavaScript's `\b` does not.
const BUSINESS_WORD = new RegExp(
  `(?<![\\p{L}\\p{N}_])(${BUSINESS_WORDS.join("|")})(?![\\p{L}\\p{N}_])`,
  "iu",
);

/** The part after the first "@", lowercased; "" when there is none. */
function emailDomainOf(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase().split("@")[1] ?? "";
}

export function reviewFlags(row: ReviewRow): ReviewFlag[] {
  const company = blankToNull(row.companyName);
  const person = blankToNull(row.contactName);
  const shown = blankToNull(row.displayName);
  const display = row.displayName ?? "";
  const domain = emailDomainOf(row.email);

  const flags: ReviewFlag[] = [];
  if (company === null && COMBINED_NAME.test(display)) flags.push("combinedName");
  if (company === null && BUSINESS_WORD.test(display)) flags.push("businessWord");
  if (company === null && domain !== "" && !FREE_EMAIL_DOMAINS.has(domain)) {
    flags.push("businessDomain");
  }
  if (company !== null && person === null && shown !== company) {
    flags.push("contactFromDisplayName");
  }
  if (company !== null && person === null && shown === company) {
    flags.push("unnamedContact");
  }
  if (
    company !== null &&
    person !== null &&
    person.toLowerCase() === company.toLowerCase()
  ) {
    flags.push("contactRepeatsCompany");
  }
  if (domain === "") flags.push("noEmail");
  return flags;
}

// ---------------------------------------------------------------------------
// Review suggestions
// ---------------------------------------------------------------------------

export type ReviewSuggestionFields = {
  companyName?: string | null;
  contactName?: string | null;
};

/** Values offered for the form. Nothing is saved until the reviewer saves. */
export type ReviewSuggestion = {
  id: "display-as-company" | "split" | "split-swapped";
  label: string;
  fields: ReviewSuggestionFields;
};

/** Splits "Company - Person" style names at the first separator. */
function splitCombinedName(display: string): { left: string; right: string; personFirst: boolean } | null {
  let best: { index: number; separator: string } | null = null;
  const lower = display.toLowerCase();
  for (const separator of COMBINED_NAME_SEPARATORS) {
    const index = lower.indexOf(separator);
    if (index >= 0 && (best === null || index < best.index)) {
      best = { index, separator };
    }
  }
  if (!best) return null;
  const left = display.slice(0, best.index).trim();
  let right = display.slice(best.index + best.separator.length).trim();
  if (best.separator === "(") right = right.replace(/\)\s*$/, "").trim();
  if (!left || !right) return null;
  // "Jane at Acme", "Jane c/o Acme" and "Jane @ Acme" name the person first.
  const personFirst = [" c/o ", " at ", " @ "].includes(best.separator);
  return { left, right, personFirst };
}

/**
 * Suggestions for a flagged row: the display name as the company, or a
 * combined name split into company and person (both ways round, since either
 * side can be the company).
 */
export function reviewSuggestions(row: ReviewRow): ReviewSuggestion[] {
  const company = blankToNull(row.companyName);
  const shown = blankToNull(row.displayName);
  if (company !== null || shown === null) return [];

  const flags = reviewFlags(row);
  const suggestions: ReviewSuggestion[] = [];

  const split = flags.includes("combinedName") ? splitCombinedName(shown) : null;
  if (split) {
    let companyPart = split.personFirst ? split.right : split.left;
    let personPart = split.personFirst ? split.left : split.right;
    // A business word on exactly one side settles which side is the company.
    if (BUSINESS_WORD.test(personPart) && !BUSINESS_WORD.test(companyPart)) {
      [companyPart, personPart] = [personPart, companyPart];
    }
    suggestions.push({
      id: "split",
      label: `Company "${companyPart}", contact "${personPart}"`,
      fields: { companyName: companyPart, contactName: personPart },
    });
    suggestions.push({
      id: "split-swapped",
      label: `Company "${personPart}", contact "${companyPart}"`,
      fields: { companyName: personPart, contactName: companyPart },
    });
  }

  if (flags.includes("businessWord") || flags.includes("businessDomain") || split) {
    suggestions.push({
      id: "display-as-company",
      label: `Company "${shown}"`,
      fields: { companyName: shown },
    });
  }
  return suggestions;
}

// Mailboxes that belong to a role, not a person.
const ROLE_MAILBOXES = new Set([
  "accounting",
  "accounts",
  "admin",
  "billing",
  "buyer",
  "contact",
  "cs",
  "customerservice",
  "engineering",
  "enquiries",
  "estimating",
  "hello",
  "help",
  "info",
  "inquiries",
  "mail",
  "noreply",
  "office",
  "orders",
  "procurement",
  "purchasing",
  "quotes",
  "rfq",
  "sales",
  "shop",
  "support",
  "team",
]);

/**
 * A first name read from the email address ("jane.doe@…" gives "Jane"). A
 * hint for the reviewer only: it is never filled in or saved by itself.
 */
export function firstNameFromEmail(email: string | null | undefined): string | null {
  const local = (normalizeEmail(email) ?? "").split("@")[0] ?? "";
  const first = local.split(/[._\-+0-9]+/).find((part) => part.length > 0) ?? "";
  if (first.length < 2 || !/^\p{L}+$/u.test(first)) return null;
  if (ROLE_MAILBOXES.has(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}
