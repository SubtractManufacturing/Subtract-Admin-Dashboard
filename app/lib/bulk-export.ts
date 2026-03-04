/**
 * Bulk export serialization for customers and vendors.
 * Export shape excludes DB id and any connected data (quotes, orders, attachments).
 */

export type ExportCustomer = {
  displayName: string;
  companyName: string | null;
  contactName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimaryContact: boolean | null;
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
  isArchived: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ExportVendor = ExportCustomer & {
  address: string | null;
  notes: string | null;
  discordId: string | null;
};

const CUSTOMER_KEYS: (keyof ExportCustomer)[] = [
  "displayName",
  "companyName",
  "contactName",
  "title",
  "email",
  "phone",
  "isPrimaryContact",
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
  "isArchived",
  "createdAt",
  "updatedAt",
];

const VENDOR_EXTRA_KEYS = ["address", "notes", "discordId"] as const;
const VENDOR_KEYS = [...CUSTOMER_KEYS, ...VENDOR_EXTRA_KEYS] as (keyof ExportVendor)[];

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toExportCustomer(row: {
  displayName: string;
  companyName?: string | null;
  contactName?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimaryContact?: boolean | null;
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
  isArchived?: boolean | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}): ExportCustomer {
  return {
    displayName: row.displayName ?? "",
    companyName: row.companyName ?? null,
    contactName: row.contactName ?? null,
    title: row.title ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    isPrimaryContact: row.isPrimaryContact ?? null,
    billingAddressLine1: row.billingAddressLine1 ?? null,
    billingAddressLine2: row.billingAddressLine2 ?? null,
    billingCity: row.billingCity ?? null,
    billingState: row.billingState ?? null,
    billingPostalCode: row.billingPostalCode ?? null,
    billingCountry: row.billingCountry ?? null,
    shippingAddressLine1: row.shippingAddressLine1 ?? null,
    shippingAddressLine2: row.shippingAddressLine2 ?? null,
    shippingCity: row.shippingCity ?? null,
    shippingState: row.shippingState ?? null,
    shippingPostalCode: row.shippingPostalCode ?? null,
    shippingCountry: row.shippingCountry ?? null,
    paymentTerms: row.paymentTerms ?? null,
    isArchived: row.isArchived ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt ?? null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt ?? null,
  };
}

/** Accepts DB-like row (e.g. Vendor with Date fields) or export-shaped row. */
export function toExportVendor(
  row: Omit<ExportCustomer, "createdAt" | "updatedAt"> & {
    address?: string | null;
    notes?: string | null;
    discordId?: string | null;
    createdAt?: Date | string | null;
    updatedAt?: Date | string | null;
  }
): ExportVendor {
  return {
    ...toExportCustomer(row),
    address: row.address ?? null,
    notes: row.notes ?? null,
    discordId: row.discordId ?? null,
  };
}

export function toCSV<T extends Record<string, unknown>>(rows: T[], columns: (keyof T)[]): string {
  const header = columns.map((c) => String(c)).join(",");
  const lines = rows.map((row) =>
    columns.map((col) => escapeCsvValue(row[col as keyof T])).join(",")
  );
  return [header, ...lines].join("\n");
}

export function customersToCSV(rows: ExportCustomer[]): string {
  return toCSV(rows, CUSTOMER_KEYS);
}

export function vendorsToCSV(rows: ExportVendor[]): string {
  return toCSV(rows, VENDOR_KEYS);
}

const EXPORT_VERSION = 1;

export function toExportJSON(
  entityType: "customers" | "vendors",
  data: ExportCustomer[] | ExportVendor[]
): string {
  const payload = {
    version: EXPORT_VERSION,
    entityType,
    exportedAt: new Date().toISOString(),
    data,
  };
  return JSON.stringify(payload, null, 0);
}

/** CSV header row only for use as a blank template. */
export function customersTemplateCSV(): string {
  return CUSTOMER_KEYS.map((c) => String(c)).join(",");
}

/** CSV header row only for use as a blank template. */
export function vendorsTemplateCSV(): string {
  return VENDOR_KEYS.map((c) => String(c)).join(",");
}
