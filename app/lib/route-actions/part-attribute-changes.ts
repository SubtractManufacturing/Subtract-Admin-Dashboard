/**
 * Manufacturing attributes (material / tolerance / finish) on a Part or
 * QuotePart: normalise the submitted values, find what actually changed, and
 * build one audit event per changed field.
 */
import type { EventLogInput } from "~/lib/events";
import type { Actor } from "./core";

export type AttributeChange = {
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

/** Trim; empty and absent values become `null`. */
export function normalizeAttribute(
  value: FormDataEntryValue | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

/** Fields whose normalised value differs from what is stored, in `fields` order. */
export function diffAttributes<F extends string>(
  fields: readonly F[],
  current: Readonly<Record<F, string | null>>,
  next: Readonly<Record<F, string | null>>,
): AttributeChange[] {
  return fields
    .filter((field) => next[field] !== current[field])
    .map((field) => ({
      field,
      oldValue: current[field],
      newValue: next[field],
    }));
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildAttributeChangeEvents(input: {
  changes: readonly AttributeChange[];
  /** Entity the audit entry hangs off (e.g. `quote`/`part`). */
  entityType: string;
  entityId: string;
  /** `quote_part` -> `quote_part_material_changed` */
  eventTypePrefix: string;
  /** `Quote Part` -> "Quote Part Material Changed" */
  titlePrefix: string;
  partName: string | null;
  /** Extra identifying metadata (ids, numbers) merged into every event. */
  metadata: Record<string, unknown>;
  actor: Actor;
}): EventLogInput[] {
  return input.changes.map((change) => ({
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: `${input.eventTypePrefix}_${change.field}_changed`,
    eventCategory: "manufacturing",
    title: `${input.titlePrefix} ${capitalize(change.field)} Changed`,
    description: `${input.partName || "Part"} changed to ${
      change.newValue || `no ${change.field}`
    }`,
    metadata: {
      partName: input.partName,
      ...input.metadata,
      oldValue: change.oldValue,
      newValue: change.newValue,
      field: change.field,
    },
    userId: input.actor.userId,
    userEmail: input.actor.userEmail,
  }));
}
