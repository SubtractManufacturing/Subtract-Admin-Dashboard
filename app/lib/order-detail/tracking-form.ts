/**
 * Parse tracking-number form posts (JSON-encoded arrays) into typed changes.
 * Pure; shared by "Manage tracking numbers" and "Ship order".
 */
import type { TrackingEntry, TrackingNumberUpdate } from "~/lib/order-tracking";

export function parsePositiveIntegerId(value: unknown, fieldName: string): number {
  const id = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`${fieldName} must contain only positive integer ids`);
  }
  return id;
}

function parseJsonArray(formData: FormData, fieldName: string): unknown[] | null {
  const raw = formData.get(fieldName);
  if (!raw) return null;
  const parsed = JSON.parse(raw.toString());
  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return parsed;
}

const carrierOf = (entry: Record<string, unknown>): string | null =>
  typeof entry.carrier === "string" ? entry.carrier : null;

const carrierDetailsOf = (entry: Record<string, unknown>): { name: string } | null => {
  const details = entry.carrierDetails as Record<string, unknown> | null | undefined;
  return details && typeof details === "object" && typeof details.name === "string"
    ? { name: details.name }
    : null;
};

export function parseJsonNumberArray(formData: FormData, fieldName: string): number[] {
  return (parseJsonArray(formData, fieldName) ?? []).map((value) =>
    parsePositiveIntegerId(value, fieldName),
  );
}

/** New tracking entries; rows without a tracking number are dropped. */
export function parseTrackingEntries(
  formData: FormData,
  fieldName: string,
): TrackingEntry[] {
  const result: TrackingEntry[] = [];
  for (const raw of parseJsonArray(formData, fieldName) ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const trackingNumber =
      typeof entry.trackingNumber === "string" ? entry.trackingNumber.trim() : "";
    if (!trackingNumber) continue;
    result.push({
      trackingNumber,
      carrier: carrierOf(entry),
      carrierDetails: carrierDetailsOf(entry),
    });
  }
  return result;
}

/** Edits to existing tracking numbers; rows without a tracking number are dropped. */
export function parseTrackingNumberUpdates(
  formData: FormData,
  fieldName: string,
): TrackingNumberUpdate[] {
  const result: TrackingNumberUpdate[] = [];
  for (const raw of parseJsonArray(formData, fieldName) ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const id = parsePositiveIntegerId(entry.id, `${fieldName}.id`);
    const trackingNumber =
      typeof entry.trackingNumber === "string" ? entry.trackingNumber : "";
    if (!trackingNumber.trim()) continue;
    result.push({
      id,
      trackingNumber,
      carrier: carrierOf(entry),
      carrierDetails: carrierDetailsOf(entry),
    });
  }
  return result;
}

export type TrackingChanges = {
  added: TrackingEntry[];
  deletedIds: number[];
  updated: TrackingNumberUpdate[];
};

/** The three tracking fields the Tracking modal posts. */
export function parseTrackingChanges(formData: FormData): TrackingChanges {
  return {
    added: parseTrackingEntries(formData, "newTrackingEntries"),
    deletedIds: parseJsonNumberArray(formData, "deletedIds"),
    updated: parseTrackingNumberUpdates(formData, "updatedTrackingEntries"),
  };
}
