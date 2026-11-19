/**
 * Client-safe shapes for Customers and Vendors on the ADR-0013 model.
 *
 * A Customer is an Organization with a customer account; a Vendor is one with
 * a vendor account. `AccountRecord` flattens the account, its Organization,
 * the primary Contact, the account's billing address and the Organization's
 * default shipping address into the field names the UI, email tokens and bulk
 * CSV have always used. `id` is the account uuid.
 */
import type { AccountType, OrganizationKind } from "../db/schema";

export type { AccountType, OrganizationKind };

export type AddressFields = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

export type AccountRecord = {
  /** The account uuid: `/customers/{id}` or `/vendors/{id}`. */
  id: string;
  type: AccountType;
  organizationId: string;
  kind: OrganizationKind;
  /** The Organization name. */
  name: string;
  /** Same as `name`; kept so existing UI and tokens read naturally. */
  displayName: string;
  /** The Organization name for a business, null for an individual. */
  companyName: string | null;
  website: string | null;
  organizationPhone: string | null;

  primaryContactId: string | null;
  contactName: string | null;
  title: string | null;
  email: string | null;
  /** The primary Contact's phone, falling back to the Organization's. */
  phone: string | null;

  billingAddressId: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingPostalCode: string | null;
  billingCountry: string | null;

  shippingAddressId: string | null;
  shippingAddressLine1: string | null;
  shippingAddressLine2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingPostalCode: string | null;
  shippingCountry: string | null;

  paymentTerms: string | null;

  isArchived: boolean;
  mergedIntoOrganizationId: string | null;
  createdAt: Date;
  /** Latest change across the account, Organization, Contact and addresses. */
  updatedAt: Date;
};

export type CustomerRecord = AccountRecord;

export type VendorRecord = AccountRecord & {
  discordId: string | null;
  /** Legacy free-text address carried over from `vendors.address`. */
  address: string | null;
  notes: string | null;
};

/**
 * Write shape for a Customer or Vendor profile. Field names match the record
 * and the bulk CSV. `name` + `kind` set the Organization directly; when they
 * are absent, `displayName` / `companyName` are mapped the way the backfill
 * maps legacy rows (a company makes a business named after it).
 */
export type AccountProfileInput = {
  name?: string | null;
  kind?: OrganizationKind | null;
  displayName?: string | null;
  companyName?: string | null;
  website?: string | null;
  organizationPhone?: string | null;

  contactName?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;

  billingAddressLine1?: string | null;
  billingAddressLine2?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingPostalCode?: string | null;
  billingCountry?: string | null;

  shippingAddressLine1?: string | null;
  shippingAddressLine2?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  shippingPostalCode?: string | null;
  shippingCountry?: string | null;

  paymentTerms?: string | null;

  // Vendor accounts only.
  discordId?: string | null;
  address?: string | null;
  notes?: string | null;
};

export type ContactRecord = {
  id: string;
  /** The `organization_contacts` link id. */
  linkId: string;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
  /** Normalized primary email and aliases. */
  emails: string[];
  /** Other active Organizations this Contact belongs to. */
  otherOrganizations: Array<{ id: string; name: string }>;
};

export type AddressRecord = AddressFields & {
  id: string;
  organizationId: string;
  label: string | null;
  isDefaultShipping: boolean;
};

export type ContactInput = {
  name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
};

export type AddressInput = Partial<AddressFields> & { label?: string | null };

/** Accept "a uuid" in route params; anything else is a legacy id or a 404. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function contactDisplayName(contact: {
  name: string | null;
  email: string | null;
}): string {
  return contact.name?.trim() || contact.email?.trim() || "Unnamed contact";
}

/** A Customer as the UI sees it: a customer account, flattened. */
export type Customer = CustomerRecord;
/** A Vendor as the UI sees it: a vendor account, flattened. */
export type Vendor = VendorRecord;

/** A form field holding an account or Contact uuid; anything else is null. */
export function uuidField(value: FormDataEntryValue | string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return isUuid(text) ? text : null;
}

/** Like {@link uuidField}, but a missing or malformed id is an error. */
export function requireUuid(value: FormDataEntryValue | string | null | undefined, label: string): string {
  const id = uuidField(value);
  if (!id) throw new Error(`${label} is required`);
  return id;
}
