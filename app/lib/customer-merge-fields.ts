/**
 * Field-level comparison for Organization merges and Contact merges
 * (ADR-0013). Pure: the merge module loads the state, this decides which
 * fields conflict, which fill in automatically, and what a set of choices
 * means.
 */
import { CustomerMergeError } from "./customer-merge-error";
import { normalizePhoneDigits } from "./customer-normalize";
import { normalizeEmail } from "./email-normalize";
import { addressIsFilled, formatAddressLines } from "./organizations/profile";
import type { AddressFields, OrganizationKind } from "./organizations/types";

export type MergeChoice = "survivor" | "merged";

export type FieldConflict<K extends string = string> = {
  field: K;
  label: string;
  survivorValue: string;
  mergedValue: string;
  /** Billing terms are never silently changed: an explicit choice is required. */
  requiresExplicitChoice: boolean;
  /** Pre-selected side in the review, when no explicit choice is required. */
  defaultChoice: MergeChoice;
};

export type FieldAutoFill<K extends string = string> = {
  field: K;
  label: string;
  value: string;
};

const clean = (value: string | null | undefined) => (value ?? "").trim();

function canonical(kind: "text" | "email" | "phone", value: string | null | undefined) {
  if (kind === "email") return normalizeEmail(value) ?? clean(value).toLowerCase();
  if (kind === "phone") return normalizePhoneDigits(value ?? null) ?? "";
  return clean(value).replace(/\s+/g, " ").toLowerCase();
}

function addressCanonical(address: Partial<AddressFields> | null | undefined) {
  if (!address) return "";
  return (["line1", "line2", "city", "state", "postalCode", "country"] as const)
    .map((key) => canonical("text", address[key]))
    .join("|");
}

type Comparison<K extends string> = {
  conflicts: FieldConflict<K>[];
  autoFills: FieldAutoFill<K>[];
};

function compareText<K extends string>(
  out: Comparison<K>,
  field: K,
  label: string,
  survivor: string | null | undefined,
  merged: string | null | undefined,
  options: { kind?: "text" | "email" | "phone"; explicit?: boolean; defaultChoice?: MergeChoice } = {},
) {
  const survivorValue = clean(survivor);
  const mergedValue = clean(merged);
  if (!mergedValue) return;
  if (!survivorValue) {
    out.autoFills.push({ field, label, value: mergedValue });
    return;
  }
  if (canonical(options.kind ?? "text", survivorValue) === canonical(options.kind ?? "text", mergedValue)) {
    return;
  }
  out.conflicts.push({
    field,
    label,
    survivorValue,
    mergedValue,
    requiresExplicitChoice: options.explicit ?? false,
    defaultChoice: options.defaultChoice ?? "survivor",
  });
}

function compareAddress<K extends string>(
  out: Comparison<K>,
  field: K,
  label: string,
  survivor: Partial<AddressFields> | null | undefined,
  merged: Partial<AddressFields> | null | undefined,
) {
  if (!addressIsFilled(merged)) return;
  if (!addressIsFilled(survivor)) {
    out.autoFills.push({ field, label, value: formatAddressLines(merged) });
    return;
  }
  if (addressCanonical(survivor) === addressCanonical(merged)) return;
  out.conflicts.push({
    field,
    label,
    survivorValue: formatAddressLines(survivor),
    mergedValue: formatAddressLines(merged),
    requiresExplicitChoice: false,
    defaultChoice: "survivor",
  });
}

/** Resolve the chosen side for every conflict and auto-fill. */
function decide<K extends string>(
  comparison: Comparison<K>,
  choices: Partial<Record<K, MergeChoice>>,
  noun: string,
): Set<K> {
  const takeFromMerged = new Set<K>(comparison.autoFills.map((fill) => fill.field));
  for (const conflict of comparison.conflicts) {
    const choice = choices[conflict.field];
    if (conflict.requiresExplicitChoice && !choice) {
      throw new CustomerMergeError(
        `${conflict.label} differ between the ${noun}; choose which to keep`,
        400,
      );
    }
    if ((choice ?? conflict.defaultChoice) === "merged") takeFromMerged.add(conflict.field);
  }
  return takeFromMerged;
}

// ---------------------------------------------------------------------------
// Organization merge
// ---------------------------------------------------------------------------

export type OrganizationMergeField =
  | "name"
  | "kind"
  | "website"
  | "organizationPhone"
  | "primaryContact"
  | "defaultShippingAddress"
  | "customerPaymentTerms"
  | "customerBillingAddress"
  | "vendorPaymentTerms"
  | "vendorBillingAddress"
  | "vendorDiscordId"
  | "vendorNotes";

export type OrganizationMergeChoices = Partial<Record<OrganizationMergeField, MergeChoice>>;

export type AccountSide = {
  id: string;
  paymentTerms: string | null;
  billingAddressId: string | null;
  billingAddress: Partial<AddressFields> | null;
  discordId: string | null;
  notes: string | null;
};

/** What the merge needs to know about one side. */
export type OrganizationMergeState = {
  id: string;
  name: string;
  kind: OrganizationKind;
  website: string | null;
  phone: string | null;
  primaryContact: { id: string; label: string } | null;
  defaultShipping: { id: string; address: Partial<AddressFields> } | null;
  customer: AccountSide | null;
  vendor: AccountSide | null;
};

const KIND_LABELS: Record<OrganizationKind, string> = {
  business: "Business",
  individual: "Individual",
};

export function compareOrganizations(
  survivor: OrganizationMergeState,
  merged: OrganizationMergeState,
): Comparison<OrganizationMergeField> {
  const out: Comparison<OrganizationMergeField> = { conflicts: [], autoFills: [] };
  // An individual joining a business usually takes the business's name and kind.
  const preferMergedIdentity = survivor.kind === "individual" && merged.kind === "business";
  const identityDefault: MergeChoice = preferMergedIdentity ? "merged" : "survivor";

  compareText(out, "name", "Name", survivor.name, merged.name, { defaultChoice: identityDefault });
  if (survivor.kind !== merged.kind) {
    out.conflicts.push({
      field: "kind",
      label: "Type",
      survivorValue: KIND_LABELS[survivor.kind],
      mergedValue: KIND_LABELS[merged.kind],
      requiresExplicitChoice: false,
      defaultChoice: identityDefault,
    });
  }
  compareText(out, "website", "Website", survivor.website, merged.website);
  compareText(out, "organizationPhone", "Main phone", survivor.phone, merged.phone, { kind: "phone" });

  if (merged.primaryContact) {
    if (!survivor.primaryContact) {
      out.autoFills.push({ field: "primaryContact", label: "Primary contact", value: merged.primaryContact.label });
    } else if (survivor.primaryContact.id !== merged.primaryContact.id) {
      out.conflicts.push({
        field: "primaryContact",
        label: "Primary contact",
        survivorValue: survivor.primaryContact.label,
        mergedValue: merged.primaryContact.label,
        requiresExplicitChoice: false,
        defaultChoice: "survivor",
      });
    }
  }

  compareAddress(
    out,
    "defaultShippingAddress",
    "Default shipping address",
    survivor.defaultShipping?.address,
    merged.defaultShipping?.address,
  );

  // Account fields only compare when both sides hold that account; otherwise
  // the merged side's account simply moves over with its own terms.
  if (survivor.customer && merged.customer) {
    compareText(out, "customerPaymentTerms", "Customer payment terms", survivor.customer.paymentTerms, merged.customer.paymentTerms, { explicit: true });
    compareAddress(out, "customerBillingAddress", "Customer billing address", survivor.customer.billingAddress, merged.customer.billingAddress);
  }
  if (survivor.vendor && merged.vendor) {
    compareText(out, "vendorPaymentTerms", "Vendor payment terms", survivor.vendor.paymentTerms, merged.vendor.paymentTerms, { explicit: true });
    compareAddress(out, "vendorBillingAddress", "Vendor billing address", survivor.vendor.billingAddress, merged.vendor.billingAddress);
    compareText(out, "vendorDiscordId", "Discord id", survivor.vendor.discordId, merged.vendor.discordId);
    compareText(out, "vendorNotes", "Vendor notes", survivor.vendor.notes, merged.vendor.notes);
  }
  return out;
}

export type OrganizationMergePlan = {
  organization: { name?: string; kind?: OrganizationKind; website?: string | null; phone?: string | null };
  /** Contact that is primary on the survivor afterwards (null: leave as is). */
  primaryContactId: string | null;
  /** Address that is the default shipping address afterwards (null: leave as is). */
  defaultShippingAddressId: string | null;
  customer: { paymentTerms?: string | null; billingAddressId?: string | null } | null;
  vendor: {
    paymentTerms?: string | null;
    billingAddressId?: string | null;
    discordId?: string | null;
    notes?: string | null;
  } | null;
};

/** Turn the comparison and the reviewer's choices into concrete updates. */
export function planOrganizationMerge(
  survivor: OrganizationMergeState,
  merged: OrganizationMergeState,
  choices: OrganizationMergeChoices,
): OrganizationMergePlan {
  const take = decide(compareOrganizations(survivor, merged), choices, "Organizations");
  const plan: OrganizationMergePlan = {
    organization: {},
    primaryContactId: null,
    defaultShippingAddressId: null,
    customer: null,
    vendor: null,
  };
  if (take.has("name")) plan.organization.name = merged.name;
  if (take.has("kind")) plan.organization.kind = merged.kind;
  if (take.has("website")) plan.organization.website = merged.website;
  if (take.has("organizationPhone")) plan.organization.phone = merged.phone;
  if (take.has("primaryContact") && merged.primaryContact) plan.primaryContactId = merged.primaryContact.id;
  if (take.has("defaultShippingAddress") && merged.defaultShipping) {
    plan.defaultShippingAddressId = merged.defaultShipping.id;
  }
  if (survivor.customer && merged.customer) {
    plan.customer = {};
    if (take.has("customerPaymentTerms")) plan.customer.paymentTerms = merged.customer.paymentTerms;
    if (take.has("customerBillingAddress")) plan.customer.billingAddressId = merged.customer.billingAddressId;
  }
  if (survivor.vendor && merged.vendor) {
    plan.vendor = {};
    if (take.has("vendorPaymentTerms")) plan.vendor.paymentTerms = merged.vendor.paymentTerms;
    if (take.has("vendorBillingAddress")) plan.vendor.billingAddressId = merged.vendor.billingAddressId;
    if (take.has("vendorDiscordId")) plan.vendor.discordId = merged.vendor.discordId;
    if (take.has("vendorNotes")) plan.vendor.notes = merged.vendor.notes;
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Contact merge
// ---------------------------------------------------------------------------

export type ContactMergeField = "name" | "title" | "email" | "phone";
export type ContactMergeChoices = Partial<Record<ContactMergeField, MergeChoice>>;

export type ContactMergeState = {
  id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
};

export function compareContacts(
  survivor: ContactMergeState,
  merged: ContactMergeState,
): Comparison<ContactMergeField> {
  const out: Comparison<ContactMergeField> = { conflicts: [], autoFills: [] };
  compareText(out, "name", "Name", survivor.name, merged.name);
  compareText(out, "title", "Title", survivor.title, merged.title);
  compareText(out, "email", "Primary email", survivor.email, merged.email, { kind: "email" });
  compareText(out, "phone", "Phone", survivor.phone, merged.phone, { kind: "phone" });
  return out;
}

export function planContactMerge(
  survivor: ContactMergeState,
  merged: ContactMergeState,
  choices: ContactMergeChoices,
): Partial<Omit<ContactMergeState, "id">> {
  const take = decide(compareContacts(survivor, merged), choices, "Contacts");
  const updates: Partial<Omit<ContactMergeState, "id">> = {};
  for (const field of ["name", "title", "email", "phone"] as const) {
    if (take.has(field)) updates[field] = merged[field];
  }
  return updates;
}
