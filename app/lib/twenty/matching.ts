/**
 * Pure rules for mapping ERP customers and quotes onto Twenty records. Matching
 * is deliberately conservative: an ambiguous company is reported, never guessed.
 */
import { normalizeEmail } from "../email-normalize";

/**
 * ERP status to Twenty rfqStatus. Applied only when the ERP status changes, so
 * REVIEWING and FOLLOW_UP set by staff in Twenty survive in between.
 *
 * Expired is left out on purpose. The ERP sets it automatically once validUntil
 * passes, with no sales decision behind it, and an expired quote can be revised
 * and re-sent. Treating it as LOST would record an outcome nobody chose.
 */
export const RFQ_STATUS_BY_QUOTE_STATUS: Readonly<Record<string, string>> = {
  RFQ: "NEW_RFQ",
  Draft: "QUOTING",
  Sent: "QUOTE_SENT",
  Accepted: "WON",
  Rejected: "LOST",
  Dropped: "LOST",
};

/** Custom unique opportunity field holding the ERP quote ID; retries reconcile by it. */
export const ERP_QUOTE_ID_FIELD = "erpQuoteId";

/** Still on its way: the quote may say Sent, but the customer does not have it yet. */
const SEND_IN_PROGRESS = new Set(["pending_approval", "queued", "sending"]);

export interface QuoteSendState {
  /** Status of the latest priced quote email, or null when none was ever queued. */
  status: string | null;
  updatedAt: Date | null;
  /** When the quote last moved to Sent. */
  quoteSentAt: Date | null;
}

/**
 * Whether a Sent quote has really gone out. With approval on, a quote turns Sent
 * before delivery, so the status alone proves nothing. RFQ acknowledgments are
 * never passed here. A failed, bounced or rejected email does not count, unless
 * staff marked the quote sent afterwards: that is their decision, made after the
 * email outcome, and it covers rejecting an approval then sending another way.
 * A rejection is saved just before the quote reverts, so the timing also stops a
 * sweep between those two writes from reading it as sent.
 */
export function isQuoteSendConfirmed(send: QuoteSendState): boolean {
  if (send.status === null || send.status === "sent") return true;
  if (SEND_IN_PROGRESS.has(send.status)) return false;
  return Boolean(
    send.quoteSentAt && send.updatedAt && send.quoteSentAt > send.updatedAt,
  );
}

const FREE_EMAIL_DOMAINS = new Set([
  "aol.com",
  "att.net",
  "bellsouth.net",
  "charter.net",
  "comcast.net",
  "cox.net",
  "fastmail.com",
  "gmail.com",
  "gmx.com",
  "googlemail.com",
  "hey.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mac.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "sbcglobal.net",
  "verizon.net",
  "yahoo.com",
  "ymail.com",
  "zoho.com",
]);

/** Dropped when comparing names, so "Acme, Inc." and "ACME" are the same company. */
const LEGAL_SUFFIXES = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "limited",
  "llc",
  "llp",
  "lp",
  "ltd",
  "pllc",
]);

/** Marks a display name as a business when the record has no contact name to compare. */
const BUSINESS_WORDS = new Set([
  ...LEGAL_SUFFIXES,
  "enterprises",
  "fabrication",
  "group",
  "industries",
  "labs",
  "machine",
  "machining",
  "manufacturing",
  "motorsports",
  "performance",
  "racing",
  "services",
  "shop",
  "solutions",
  "systems",
  "technologies",
  "works",
]);

function nameWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** "Tri-Mark, LLC" and "Tri Mark" both become "trimark". */
export function normalizeCompanyName(value: string | null | undefined): string {
  const words = nameWords(value ?? "");
  const withoutSuffix = words.filter((word) => !LEGAL_SUFFIXES.has(word));
  return (withoutSuffix.length > 0 ? withoutSuffix : words).join("");
}

/** The email's domain, unless it is a personal mailbox shared by unrelated people. */
export function businessDomainFromEmail(
  email: string | null | undefined,
): string | null {
  const domain = normalizeEmail(email)?.split("@")[1];
  if (!domain || !domain.includes(".") || FREE_EMAIL_DOMAINS.has(domain)) {
    return null;
  }
  return domain;
}

/** "https://www.Acme.com/about" becomes "acme.com". */
export function normalizeDomain(value: string | null | undefined): string | null {
  const host = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  return host || null;
}

export interface CompanyIdentity {
  /** Stated or strongly implied by the ERP record; may create a company. */
  name: string | null;
  /** A display name that might be a person; may only link to an existing company. */
  weakName: string | null;
  domain: string | null;
}

export interface CustomerCompanyFields {
  companyName: string | null;
  displayName: string;
  contactName: string | null;
  email: string | null;
}

/**
 * Which company a customer account represents. The manual quote form stores only
 * displayName, so a blank companyName does not mean there is no company.
 */
export function companyIdentityFor(customer: CustomerCompanyFields): CompanyIdentity {
  const domain = businessDomainFromEmail(customer.email);
  const companyName = customer.companyName?.trim();
  if (companyName) return { name: companyName, weakName: null, domain };

  const contact = customer.contactName?.trim() ?? "";
  let display = customer.displayName.trim();
  // RFQ intake writes "Company - Contact"; keep the company half.
  if (contact && display.toLowerCase().endsWith(` - ${contact.toLowerCase()}`)) {
    display = display.slice(0, -(contact.length + 3)).trim();
  }

  const isContactName =
    !display || normalizeCompanyName(display) === normalizeCompanyName(contact);
  if (isContactName) return { name: null, weakName: null, domain };

  const looksLikeBusiness =
    Boolean(contact) || nameWords(display).some((word) => BUSINESS_WORDS.has(word));
  return looksLikeBusiness
    ? { name: display, weakName: null, domain }
    : { name: null, weakName: display, domain };
}

/** Stored with the link: when this changes the company is resolved again. */
export function companyKeyFor(identity: CompanyIdentity): string {
  const name = normalizeCompanyName(identity.name ?? identity.weakName);
  return `${name}|${identity.domain ?? ""}`;
}

export interface TwentyCompanySummary {
  id: string;
  name: string;
  domain: string | null;
}

/** Saved with a failure so staff can pick the right company on the admin page. */
export interface CompanyChoiceDetail {
  kind: "company_choice";
  customerId: number;
  companyName: string;
  candidates: TwentyCompanySummary[];
}

export type CompanyMatch =
  | { kind: "matched"; id: string }
  | { kind: "ambiguous"; candidates: TwentyCompanySummary[] }
  | { kind: "none"; domainTaken: boolean };

/** Imported accounts are often named after their domain: "acme.com" or "Acme". */
function isNamedAfterDomain(company: TwentyCompanySummary, domain: string): boolean {
  const name = normalizeCompanyName(company.name);
  return (
    name === normalizeCompanyName(domain) ||
    name === normalizeCompanyName(domain.split(".")[0])
  );
}

/** A literal placeholder such as "acme.com", as opposed to a chosen name like "Acme". */
function isDomainPlaceholder(company: TwentyCompanySummary, domain: string): boolean {
  return normalizeCompanyName(company.name) === normalizeCompanyName(domain);
}

function sharesWord(a: string, b: string): boolean {
  const words = new Set(
    nameWords(a).filter((word) => !LEGAL_SUFFIXES.has(word) && word.length > 2),
  );
  return nameWords(b).some((word) => words.has(word));
}

/** Names first, then a business domain. Free-mail domains never reach this far. */
export function matchCompany(
  companies: readonly TwentyCompanySummary[],
  identity: CompanyIdentity,
): CompanyMatch {
  const { domain } = identity;
  const key = normalizeCompanyName(identity.name ?? identity.weakName);
  const byName = key
    ? companies.filter((company) => normalizeCompanyName(company.name) === key)
    : [];

  if (byName.length > 0) {
    const sameDomain = byName.filter((company) => company.domain === domain);
    if (domain && sameDomain.length === 1) {
      return { kind: "matched", id: sameDomain[0].id };
    }
    // One name on a different domain may be an unrelated company of the same name.
    const conflicting =
      Boolean(domain) && byName.every((company) => company.domain && company.domain !== domain);
    if (byName.length === 1 && !conflicting) return { kind: "matched", id: byName[0].id };
    return { kind: "ambiguous", candidates: byName };
  }

  if (!domain) return { kind: "none", domainTaken: false };

  // A name that merely resembles the domain counts only when the company records
  // no domain of its own: "Acme" at other.com is not the account for acme.com.
  const byDomain = companies.filter(
    (company) =>
      company.domain === domain || (!company.domain && isNamedAfterDomain(company, domain)),
  );
  const holdsDomain = byDomain.some((company) => company.domain === domain);
  // A stated name that disagrees with the domain's account is a different company:
  // someone at trimark.com can also buy for Britzman Enterprises.
  const statedName = identity.name;
  const usable = statedName
    ? byDomain.filter(
        (company) =>
          isDomainPlaceholder(company, domain) || sharesWord(company.name, statedName),
      )
    : byDomain;

  if (usable.length === 1) return { kind: "matched", id: usable[0].id };
  if (usable.length > 1) {
    const exact = usable.filter((company) => company.domain === domain);
    if (exact.length === 1) return { kind: "matched", id: exact[0].id };
    return { kind: "ambiguous", candidates: usable };
  }
  return { kind: "none", domainTaken: holdsDomain };
}

export function splitContactName(
  value: string | null | undefined,
): { firstName: string; lastName: string } | null {
  const name = value?.trim().replace(/\s+/g, " ");
  if (!name) return null;
  const lastSpace = name.lastIndexOf(" ");
  return lastSpace === -1
    ? { firstName: name, lastName: "" }
    : { firstName: name.slice(0, lastSpace), lastName: name.slice(lastSpace + 1) };
}

export interface TwentyPhoneInput {
  primaryPhoneNumber: string;
  primaryPhoneCountryCode?: string;
  primaryPhoneCallingCode?: string;
}

/**
 * ERP phones are free text and Twenty rejects a write with an invalid number, so
 * anything that does not parse cleanly is left out rather than failing the sync.
 */
export function toTwentyPhone(
  value: string | null | undefined,
): TwentyPhoneInput | null {
  const withoutExtension = (value ?? "")
    .trim()
    .replace(/\s*(?:ext\.?|extension|x|#)\s*\d*\s*$/i, "");
  if (/\p{L}/u.test(withoutExtension)) return null;

  const digits = withoutExtension.replace(/\D/g, "");
  if (withoutExtension.startsWith("+") && !withoutExtension.startsWith("+1")) {
    return digits.length >= 8 && digits.length <= 15
      ? { primaryPhoneNumber: `+${digits}` }
      : null;
  }
  const national =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  return {
    primaryPhoneNumber: national,
    primaryPhoneCountryCode: "US",
    primaryPhoneCallingCode: "+1",
  };
}

export function phoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "").slice(-10);
}

/** Twenty stores money as integer micros. Blank or $0 totals stay unset until priced. */
export function toTwentyAmount(
  total: string | null | undefined,
): { amountMicros: number; currencyCode: string } | null {
  const value = Number.parseFloat(total ?? "");
  if (!Number.isFinite(value) || value <= 0) return null;
  return { amountMicros: Math.round(value * 100) * 10_000, currencyCode: "USD" };
}

/** Sent when a priced quote is corrected to $0, so Twenty does not keep the old amount. */
export const CLEARED_TWENTY_AMOUNT = { amountMicros: null, currencyCode: "USD" };

export function opportunityName(quoteNumber: string, companyLabel: string): string {
  return `${quoteNumber} - ${companyLabel}`;
}
