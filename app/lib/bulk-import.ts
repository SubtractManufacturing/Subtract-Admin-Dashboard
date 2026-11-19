/**
 * Bulk import parsing, validation, and existing-entity resolution.
 * Match key: email (primary), then displayName (fallback).
 *
 * The CSV columns are unchanged by ADR-0013. Each row maps to an
 * Organization (displayName/companyName), its primary Contact (contactName,
 * title, email, phone), its account (paymentTerms, vendor fields) and its
 * billing and default shipping addresses. `isPrimaryContact` is accepted and
 * ignored: the row's person is always the primary Contact.
 */

import { db } from "./db";
import { accounts, organizations, type AccountType } from "./db/schema";
import { and, eq, sql } from "drizzle-orm";
import { normalizeEmail } from "./email-normalize";
import {
  activeAccountIdsForContacts,
  findActiveContactIdsByEmail,
} from "./organizations/accounts.server";
import { organizationFromLegacy } from "./organizations/profile";
import type { CustomerInput } from "./customers";
import type { VendorInput } from "./vendors";

export type ImportRowCustomer = Record<string, unknown> & { displayName: string };
export type ImportRowVendor = ImportRowCustomer & { address?: string | null; notes?: string | null; discordId?: string | null };

export type BulkImportPreviewRow = {
  rowIndex: number;
  data: ImportRowCustomer | ImportRowVendor;
  match: "new" | "existing";
  existingId?: string;
  error?: string;
};

function parseCSV(buffer: Buffer): Record<string, string>[] {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((c === "," && !inQuotes) || c === "\n") {
        out.push(current.trim());
        current = "";
      } else {
        current += c;
      }
    }
    out.push(current.trim());
    return out;
  };

  const headers = parseLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = values[j] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function normalizeKey(key: string): string {
  return key.replace(/\s+/g, "").replace(/-/g, "");
}

function mapCSVRowToObject(row: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keyMap: Record<string, string> = {
    displayname: "displayName",
    companyname: "companyName",
    contactname: "contactName",
    title: "title",
    email: "email",
    phone: "phone",
    isprimarycontact: "isPrimaryContact",
    billingaddressline1: "billingAddressLine1",
    billingaddressline2: "billingAddressLine2",
    billingcity: "billingCity",
    billingstate: "billingState",
    billingpostalcode: "billingPostalCode",
    billingcountry: "billingCountry",
    shippingaddressline1: "shippingAddressLine1",
    shippingaddressline2: "shippingAddressLine2",
    shippingcity: "shippingCity",
    shippingstate: "shippingState",
    shippingpostalcode: "shippingPostalCode",
    shippingcountry: "shippingCountry",
    paymentterms: "paymentTerms",
    isarchived: "isArchived",
    createdat: "createdAt",
    updatedat: "updatedAt",
    address: "address",
    notes: "notes",
    discordid: "discordId",
  };
  for (const [k, v] of Object.entries(row)) {
    const normalized = normalizeKey(k).toLowerCase();
    const targetKey = keyMap[normalized] ?? k;
    let value: unknown = v === "" ? null : v;
    if (targetKey === "isPrimaryContact" || targetKey === "isArchived") {
      value = v === "true" || v === "1" || v === "yes";
    }
    out[targetKey] = value;
  }
  return out;
}

export function parseImportFile(
  buffer: Buffer,
  format?: "csv" | "json"
): { rows: Record<string, unknown>[]; format: "csv" | "json" } {
  const str = buffer.toString("utf-8").trim();
  const resolvedFormat: "csv" | "json" =
    format ?? (str.startsWith("[") || str.startsWith("{") ? "json" : "csv");

  if (resolvedFormat === "json") {
    const parsed = JSON.parse(str) as { data?: unknown[]; version?: number; entityType?: string };
    const data = Array.isArray(parsed) ? parsed : parsed?.data;
    if (!Array.isArray(data)) {
      throw new Error("JSON must be an array or an object with a 'data' array");
    }
    return { rows: data as Record<string, unknown>[], format: "json" };
  }

  const csvRows = parseCSV(buffer);
  const rows = csvRows.map((r) => mapCSVRowToObject(r));
  return { rows, format: "csv" };
}

function getString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

export function validateCustomerRow(
  row: Record<string, unknown>,
  rowIndex: number
): { ok: true; data: CustomerInput } | { ok: false; error: string } {
  const displayName = getString(row.displayName);
  if (!displayName) {
    return { ok: false, error: `Row ${rowIndex + 1}: displayName is required` };
  }
  const data: CustomerInput = {
    displayName,
    companyName: getString(row.companyName),
    contactName: getString(row.contactName),
    title: getString(row.title),
    email: getString(row.email),
    phone: getString(row.phone),
    billingAddressLine1: getString(row.billingAddressLine1),
    billingAddressLine2: getString(row.billingAddressLine2),
    billingCity: getString(row.billingCity),
    billingState: getString(row.billingState),
    billingPostalCode: getString(row.billingPostalCode),
    billingCountry: getString(row.billingCountry) ?? "US",
    shippingAddressLine1: getString(row.shippingAddressLine1),
    shippingAddressLine2: getString(row.shippingAddressLine2),
    shippingCity: getString(row.shippingCity),
    shippingState: getString(row.shippingState),
    shippingPostalCode: getString(row.shippingPostalCode),
    shippingCountry: getString(row.shippingCountry) ?? "US",
    paymentTerms: getString(row.paymentTerms),
  };
  return { ok: true, data };
}

export function validateVendorRow(
  row: Record<string, unknown>,
  rowIndex: number
): { ok: true; data: VendorInput } | { ok: false; error: string } {
  const customerResult = validateCustomerRow(row, rowIndex);
  if (!customerResult.ok) return customerResult;
  const data: VendorInput = {
    ...customerResult.data,
    address: getString(row.address),
    notes: getString(row.notes),
    discordId: getString(row.discordId),
  };
  return { ok: true, data };
}

/**
 * Match by email first (a Contact's primary email or alias, normalized); if no
 * email or no match, match the Organization name the row maps to.
 */
async function resolveExistingAccount(
  type: AccountType,
  email: string | null,
  displayName: string,
  companyName: string | null = null,
): Promise<{ id: string } | null> {
  const normalized = normalizeEmail(email);
  if (normalized) {
    const contactIds = await findActiveContactIdsByEmail(db, normalized);
    const [byEmail] = await activeAccountIdsForContacts(db, type, contactIds);
    if (byEmail) return { id: byEmail };
  }
  const { name } = organizationFromLegacy({ displayName, companyName });
  const [byName] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .innerJoin(organizations, eq(organizations.id, accounts.organizationId))
    .where(
      and(
        eq(accounts.type, type),
        eq(accounts.isArchived, false),
        eq(organizations.isArchived, false),
        sql`lower(${organizations.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  return byName ?? null;
}

export async function resolveExistingCustomer(
  email: string | null,
  displayName: string,
  companyName: string | null = null,
): Promise<{ id: string } | null> {
  return resolveExistingAccount("customer", email, displayName, companyName);
}

export async function resolveExistingVendor(
  email: string | null,
  displayName: string,
  companyName: string | null = null,
): Promise<{ id: string } | null> {
  return resolveExistingAccount("vendor", email, displayName, companyName);
}

export async function getImportPreview(
  rows: Record<string, unknown>[],
  entityType: "customers" | "vendors"
): Promise<BulkImportPreviewRow[]> {
  const preview: BulkImportPreviewRow[] = [];
  const validate = entityType === "customers" ? validateCustomerRow : validateVendorRow;
  const resolve = entityType === "customers" ? resolveExistingCustomer : resolveExistingVendor;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const validated = validate(row as Record<string, unknown>, i);
    if (!validated.ok) {
      preview.push({
        rowIndex: i,
        data: row as ImportRowCustomer,
        match: "new",
        error: validated.error,
      });
      continue;
    }
    const email = entityType === "customers" ? (validated.data as CustomerInput).email : (validated.data as VendorInput).email;
    const displayName = validated.data.displayName ?? "";
    const existing = await resolve(email ?? null, displayName, validated.data.companyName ?? null);
    preview.push({
      rowIndex: i,
      data: row as ImportRowCustomer,
      match: existing ? "existing" : "new",
      existingId: existing?.id,
    });
  }
  return preview;
}
