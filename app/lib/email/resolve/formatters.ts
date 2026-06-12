/**
 * Pure formatting utilities for the email merge token resolver.
 * All functions are side-effect-free — no database access here.
 */

import type { NormalizedAddress, NormalizedPart } from "./types";
import { formatDateForDisplay } from "~/lib/date-display";

// ── Currency ──────────────────────────────────────────────────────────

/**
 * Format a numeric string as a USD display value (e.g. "1200.00" → "$1,200.00").
 * Returns null when the input is null, undefined, or non-numeric.
 */
export function formatCurrency(amount: string | null | undefined): string | null {
  if (amount == null) return null;
  const num = parseFloat(amount);
  if (!Number.isFinite(num)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(num);
}

// ── Dates ─────────────────────────────────────────────────────────────

/**
 * Format a Date as "Month D, YYYY" (e.g. "March 15, 2026").
 * Returns null when input is null or undefined.
 */
export function formatDate(date: Date | null | undefined): string | null {
  if (date == null) return null;
  return formatDateForDisplay(date);
}

// ── Addresses ─────────────────────────────────────────────────────────

/**
 * Format a structured address into a multi-line block.
 * Blank / whitespace-only lines are omitted.
 *
 * Example:
 *   Acme Corp
 *   123 Main St
 *   Portland, OR 97201
 *
 * Returns null when no meaningful address data is present.
 */
export function formatAddress(addr: NormalizedAddress): string | null {
  const cityStateZip = buildCityStateZip(addr.city, addr.state, addr.postalCode);
  const lines = [addr.company, addr.line1, addr.line2, cityStateZip].filter(
    (l): l is string => typeof l === "string" && l.trim().length > 0,
  );
  return lines.length > 0 ? lines.join("\n") : null;
}

function buildCityStateZip(
  city?: string | null,
  state?: string | null,
  postalCode?: string | null,
): string | null {
  const c = city?.trim();
  const s = state?.trim();
  const z = postalCode?.trim();
  if (!c && !s && !z) return null;
  const cityState = [c, s].filter(Boolean).join(", ");
  if (z) {
    return cityState ? `${cityState} ${z}` : z;
  }
  return cityState;
}

// ── Parts ─────────────────────────────────────────────────────────────

/** Placeholder for a missing per-part field in comma-separated merge tokens (non-empty for validation). */
const PART_FIELD_PLACEHOLDER = "—";

/**
 * Build a comma-separated list of part names for use in {{partNames}}.
 * Returns null when the list is empty.
 */
export function formatPartNames(parts: NormalizedPart[]): string | null {
  const names = parts.map((p) => p.name).filter(Boolean);
  return names.length > 0 ? names.join(", ") : null;
}

/**
 * Build the pre-formatted multi-line {{partSpecs}} block.
 * Each part renders as labeled lines; blank fields are omitted.
 * Parts are separated by a blank line.
 *
 * Example:
 *   Name: static wiper base
 *   Material: 4140 H900
 *   Tolerance: +/- 0.005"
 *   Finishing: As finished
 *
 *   Name: Robot Gripper Baseplate
 *   Material: 6061 T6511
 *   Tolerance: +/- 0.001"
 *   Finishing: Anodized
 *
 * Returns null when the list is empty.
 */
export function formatPartSpecs(parts: NormalizedPart[]): string | null {
  if (parts.length === 0) return null;

  const blocks = parts.map((part) => {
    const lines: string[] = [`Name: ${part.name}`];
    if (part.material?.trim()) lines.push(`Material: ${part.material.trim()}`);
    if (part.tolerance?.trim()) lines.push(`Tolerance: ${part.tolerance.trim()}`);
    if (part.finishing?.trim()) lines.push(`Finishing: ${part.finishing.trim()}`);
    return lines.join("\n");
  });

  return blocks.join("\n\n");
}

/**
 * Comma-separated {{partMaterials}}: one segment per entry in `parts` (same order as
 * {{partNames}} / {{partSpecs}}). Blank material uses PART_FIELD_PLACEHOLDER.
 */
export function formatPartMaterials(parts: NormalizedPart[]): string | null {
  if (parts.length === 0) return null;

  const segments = parts.map((p) =>
    p.material?.trim() ? p.material.trim() : PART_FIELD_PLACEHOLDER,
  );
  return segments.join(", ");
}

/**
 * Comma-separated {{partQtys}}: one segment per entry in `parts`, same order as other part tokens.
 * Unknown/null quantity uses PART_FIELD_PLACEHOLDER.
 */
export function formatPartQtys(parts: NormalizedPart[]): string | null {
  if (parts.length === 0) return null;

  const segments = parts.map((p) =>
    p.quantity != null && Number.isFinite(p.quantity)
      ? String(p.quantity)
      : PART_FIELD_PLACEHOLDER,
  );
  return segments.join(", ");
}
