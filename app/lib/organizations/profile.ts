/**
 * Pure mapping between the flat Customer/Vendor profile shape and the
 * Organization, Contact, account and address rows behind it. Shared by the
 * data layer, bulk import, intake and the reconciliation check so all of them
 * agree with the SQL backfill.
 */
import type {
  AccountProfileInput,
  AddressFields,
  AddressInput,
  OrganizationKind,
} from "./types";

export const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
};

type LegacyNameFields = {
  displayName?: string | null;
  companyName?: string | null;
  contactName?: string | null;
};

/**
 * How a legacy Customer or Vendor row maps onto an Organization and its
 * primary Contact. Mirrors `pg_temp.crm_backfill_party` in
 * scripts/sql/organizations-backfill.sql.
 */
export function organizationFromLegacy(row: LegacyNameFields): {
  kind: OrganizationKind;
  name: string;
  contactName: string | null;
} {
  const company = blankToNull(row.companyName);
  const shown = blankToNull(row.displayName);
  const person = blankToNull(row.contactName);
  return {
    kind: company ? "business" : "individual",
    name: company ?? shown ?? (row.displayName ?? ""),
    contactName: person ?? (company === null || shown !== company ? shown : null),
  };
}

/**
 * The Organization fields a profile write asks for, or undefined when it does
 * not touch them. Explicit `name` / `kind` win over legacy display/company.
 */
export function organizationFieldsFromInput(
  input: AccountProfileInput,
  current?: { name: string; kind: OrganizationKind },
): { name: string; kind: OrganizationKind } | undefined {
  if (input.name !== undefined || input.kind !== undefined) {
    const name = blankToNull(input.name) ?? current?.name;
    const kind = input.kind ?? current?.kind ?? "business";
    if (!name) return undefined;
    return { name, kind };
  }
  if (input.companyName === undefined && input.displayName !== undefined) {
    // A rename alone keeps the Organization's kind.
    const name = blankToNull(input.displayName) ?? current?.name;
    if (!name) return undefined;
    return { name, kind: current?.kind ?? "individual" };
  }
  if (input.displayName !== undefined || input.companyName !== undefined) {
    const mapped = organizationFromLegacy({
      displayName: input.displayName ?? current?.name ?? null,
      companyName: input.companyName ?? null,
    });
    if (!mapped.name) return undefined;
    return { name: mapped.name, kind: mapped.kind };
  }
  return undefined;
}

const ADDRESS_KEYS = ["line1", "line2", "city", "state", "postalCode", "country"] as const;

/** Address fields from the flat `billing*` or `shipping*` profile columns. */
export function addressFromProfile(
  input: AccountProfileInput,
  prefix: "billing" | "shipping",
): Partial<AddressFields> | undefined {
  const source = {
    line1: input[`${prefix}AddressLine1`],
    line2: input[`${prefix}AddressLine2`],
    city: input[`${prefix}City`],
    state: input[`${prefix}State`],
    postalCode: input[`${prefix}PostalCode`],
    country: input[`${prefix}Country`],
  } as const;
  const touched = ADDRESS_KEYS.filter((key) => source[key] !== undefined);
  if (touched.length === 0) return undefined;
  const fields: Partial<AddressFields> = {};
  for (const key of touched) fields[key] = blankToNull(source[key]);
  return fields;
}

/** An address counts as filled when any field but the defaulted country is set. */
export function addressIsFilled(address: Partial<AddressFields> | AddressInput | null | undefined): boolean {
  if (!address) return false;
  return [address.line1, address.line2, address.city, address.state, address.postalCode].some(
    (value) => blankToNull(value) !== null,
  );
}

export function formatAddressLines(address: Partial<AddressFields> | null | undefined): string {
  if (!address) return "";
  const cityLine = [blankToNull(address.city), blankToNull(address.state)]
    .filter(Boolean)
    .join(", ");
  return [
    blankToNull(address.line1),
    blankToNull(address.line2),
    [cityLine, blankToNull(address.postalCode)].filter(Boolean).join(" "),
    blankToNull(address.country),
  ]
    .filter(Boolean)
    .join(", ");
}

/** Domain of an email, lowercased, or null. */
export function emailDomain(email: string | null | undefined): string | null {
  const at = (email ?? "").lastIndexOf("@");
  if (at < 0) return null;
  const domain = (email ?? "").slice(at + 1).trim().toLowerCase();
  return domain.includes(".") ? domain : null;
}

const PROFILE_FORM_KEYS = [
  "name",
  "website",
  "organizationPhone",
  "contactName",
  "title",
  "email",
  "phone",
  "billingAddressLine1",
  "billingAddressLine2",
  "billingCity",
  "billingState",
  "billingPostalCode",
  "billingCountry",
  "shippingAddressLine1",
  "shippingAddressLine2",
  "shippingCity",
  "shippingState",
  "shippingPostalCode",
  "shippingCountry",
  "paymentTerms",
  "discordId",
  "address",
  "notes",
] as const satisfies ReadonlyArray<keyof AccountProfileInput>;

/**
 * A partial profile write from a form: only the fields the form posted are
 * changed. `kind` accepts "business" or "individual". Legacy `displayName` /
 * `companyName` fields are ignored here; forms post `name` and `kind`.
 */
export function profileInputFromForm(form: FormData): AccountProfileInput {
  const input: AccountProfileInput = {};
  for (const key of PROFILE_FORM_KEYS) {
    if (form.has(key)) input[key] = blankToNull(String(form.get(key) ?? ""));
  }
  if (form.has("kind")) {
    input.kind = form.get("kind") === "individual" ? "individual" : "business";
  }
  return input;
}
