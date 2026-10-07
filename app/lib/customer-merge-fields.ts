import { CustomerMergeError } from "./customer-merge-error";
import { normalizePhoneDigits } from "./customer-normalize";
import { customers } from "./db/schema";
import { normalizeEmail } from "./email-normalize";

export type MergeFieldKey =
  | "displayName"
  | "companyName"
  | "contactName"
  | "title"
  | "email"
  | "phone"
  | "paymentTerms"
  | "billingAddress"
  | "shippingAddress";

export type MergeChoice = "survivor" | "merged";
export type MergeChoices = Partial<Record<MergeFieldKey, MergeChoice>>;

export type FieldConflict = {
  field: MergeFieldKey;
  label: string;
  survivorValue: string;
  mergedValue: string;
  /** Billing terms are never silently changed: an explicit choice is required. */
  requiresExplicitChoice: boolean;
};

export type FieldAutoFill = {
  field: MergeFieldKey;
  label: string;
  value: string;
};

export type CustomerRow = typeof customers.$inferSelect;

const SCALAR_FIELDS = [
  ["displayName", "Display name"],
  ["companyName", "Company"],
  ["contactName", "Contact name"],
  ["title", "Title"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["paymentTerms", "Payment terms"],
] as const satisfies ReadonlyArray<readonly [keyof CustomerRow & MergeFieldKey, string]>;

const ADDRESS_FIELDS = {
  billingAddress: {
    label: "Billing address",
    columns: [
      "billingAddressLine1",
      "billingAddressLine2",
      "billingCity",
      "billingState",
      "billingPostalCode",
      "billingCountry",
    ],
    // Country has a column default, so it alone never makes an address "filled".
    filledColumns: [
      "billingAddressLine1",
      "billingAddressLine2",
      "billingCity",
      "billingState",
      "billingPostalCode",
    ],
  },
  shippingAddress: {
    label: "Shipping address",
    columns: [
      "shippingAddressLine1",
      "shippingAddressLine2",
      "shippingCity",
      "shippingState",
      "shippingPostalCode",
      "shippingCountry",
    ],
    filledColumns: [
      "shippingAddressLine1",
      "shippingAddressLine2",
      "shippingCity",
      "shippingState",
      "shippingPostalCode",
    ],
  },
} as const satisfies Record<
  "billingAddress" | "shippingAddress",
  {
    label: string;
    columns: ReadonlyArray<keyof CustomerRow>;
    filledColumns: ReadonlyArray<keyof CustomerRow>;
  }
>;

const clean = (value: string | null | undefined) => (value ?? "").trim();

function canonicalScalar(field: MergeFieldKey, value: string | null): string {
  if (field === "email") return normalizeEmail(value) ?? clean(value).toLowerCase();
  if (field === "phone") return normalizePhoneDigits(value) ?? "";
  return clean(value).replace(/\s+/g, " ").toLowerCase();
}

function addressText(
  customer: CustomerRow,
  field: "billingAddress" | "shippingAddress",
): string {
  return ADDRESS_FIELDS[field].columns
    .map((column) => clean(customer[column]))
    .filter(Boolean)
    .join(", ");
}

function addressCanonical(
  customer: CustomerRow,
  field: "billingAddress" | "shippingAddress",
): string {
  return ADDRESS_FIELDS[field].columns
    .map((column) => clean(customer[column]).replace(/\s+/g, " ").toLowerCase())
    .join("|");
}

function addressIsFilled(
  customer: CustomerRow,
  field: "billingAddress" | "shippingAddress",
): boolean {
  return ADDRESS_FIELDS[field].filledColumns.some((column) => clean(customer[column]));
}

export function compareFields(survivor: CustomerRow, merged: CustomerRow) {
  const conflicts: FieldConflict[] = [];
  const autoFills: FieldAutoFill[] = [];

  for (const [field, label] of SCALAR_FIELDS) {
    const survivorValue = clean(survivor[field]);
    const mergedValue = clean(merged[field]);
    if (!mergedValue) continue;
    if (!survivorValue) {
      autoFills.push({ field, label, value: mergedValue });
    } else if (
      canonicalScalar(field, survivorValue) !== canonicalScalar(field, mergedValue)
    ) {
      conflicts.push({
        field,
        label,
        survivorValue,
        mergedValue,
        requiresExplicitChoice: field === "paymentTerms",
      });
    }
  }

  for (const field of ["billingAddress", "shippingAddress"] as const) {
    if (!addressIsFilled(merged, field)) continue;
    if (!addressIsFilled(survivor, field)) {
      autoFills.push({
        field,
        label: ADDRESS_FIELDS[field].label,
        value: addressText(merged, field),
      });
    } else if (addressCanonical(survivor, field) !== addressCanonical(merged, field)) {
      conflicts.push({
        field,
        label: ADDRESS_FIELDS[field].label,
        survivorValue: addressText(survivor, field),
        mergedValue: addressText(merged, field),
        requiresExplicitChoice: false,
      });
    }
  }

  return { conflicts, autoFills };
}

/** Column updates that apply auto-fills and the chosen side of each conflict. */
export function resolveFieldUpdates(
  survivor: CustomerRow,
  merged: CustomerRow,
  choices: MergeChoices,
): Partial<typeof customers.$inferInsert> {
  const { conflicts, autoFills } = compareFields(survivor, merged);
  const takeFromMerged = new Set<MergeFieldKey>(autoFills.map((fill) => fill.field));

  for (const conflict of conflicts) {
    const choice = choices[conflict.field];
    if (conflict.requiresExplicitChoice && !choice) {
      throw new CustomerMergeError(
        `${conflict.label} differ between the Customers; choose which to keep`,
        400,
      );
    }
    if (choice === "merged") takeFromMerged.add(conflict.field);
  }

  // Every column copied here is nullable text except displayName, which is only
  // ever copied from a Customer that already has one.
  const updates: Record<string, string | null> = {};
  for (const [field] of SCALAR_FIELDS) {
    if (takeFromMerged.has(field)) updates[field] = merged[field];
  }
  for (const field of ["billingAddress", "shippingAddress"] as const) {
    if (!takeFromMerged.has(field)) continue;
    for (const column of ADDRESS_FIELDS[field].columns) {
      updates[column] = merged[column];
    }
  }
  return updates as Partial<typeof customers.$inferInsert>;
}
