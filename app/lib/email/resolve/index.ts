/**
 * Email Merge Token Resolver — Public API
 *
 * Dispatches to the correct entity resolver based on entity kind, returning
 * a flat ResolvedTokenMap of string values ready for {{placeholder}} interpolation.
 *
 * Usage:
 *   const tokens = await resolveEntityTokens("quote", entityId);
 *
 * See docs/email-template-merge-tokens.md for the full token reference.
 */

import type { EntityKind, ResolvedTokenMap } from "./types";
import { resolveQuoteTokens } from "./quote.server";
import { resolveOrderTokens } from "./order.server";
import { resolveCustomerTokens } from "./customer.server";
import { resolveVendorTokens } from "./vendor.server";

export type {
  EntityKind,
  ResolvedTokenMap,
  MergeTokenDefinition,
  MergeTokenKey,
  NormalizedPart,
  NormalizedAddress,
} from "./types";
export {
  MERGE_TOKEN_CATALOG,
  RESERVED_MERGE_TOKEN_KEYS,
  MERGE_TOKEN_BY_KEY,
} from "./types";

// ── Entity registry ───────────────────────────────────────────────────

type EntityResolver = (entityId: string) => Promise<ResolvedTokenMap>;

const ENTITY_RESOLVERS = {
  quote: resolveQuoteTokens,
  order: resolveOrderTokens,
  customer: resolveCustomerTokens,
  vendor: resolveVendorTokens,
} as const satisfies Record<EntityKind, EntityResolver>;

/**
 * Resolve merge tokens for any supported entity kind.
 * Throws if the entity cannot be found or the id is invalid.
 */
export async function resolveEntityTokens(
  entityKind: EntityKind,
  entityId: string,
): Promise<ResolvedTokenMap> {
  const resolver = ENTITY_RESOLVERS[entityKind];
  if (!resolver) {
    throw new Error(`No token resolver registered for entity kind: ${entityKind}`);
  }
  return resolver(entityId);
}

// ── Validation utilities ──────────────────────────────────────────────

/**
 * Extract all {{tokenName}} keys referenced in an array of strings.
 * Uses the same /\{\{(\w+)\}\}/ pattern as interpolateTemplateString.
 */
export function extractPlaceholderKeys(strings: string[]): Set<string> {
  const keys = new Set<string>();
  const pattern = /\{\{(\w+)\}\}/g;
  for (const str of strings) {
    let match;
    while ((match = pattern.exec(str)) !== null) {
      keys.add(match[1]);
    }
  }
  return keys;
}

/**
 * Fail-closed pre-interpolation guard.
 *
 * Validates that every {{token}} referenced in the given strings is present
 * in the merged map with a non-empty string value. Call this BEFORE interpolation
 * so the error message names the missing tokens explicitly.
 *
 * Returns an error message string when validation fails, null when all tokens resolve.
 *
 * @param templateStrings  All user-controlled strings: subject, body copy slots, button labels/links.
 * @param mergedMap        Final merged token map (snippets merged first, then resolver output).
 */
export function validateMergeTokens(
  templateStrings: string[],
  mergedMap: Record<string, string>,
): string | null {
  const referenced = extractPlaceholderKeys(templateStrings);
  const missing: string[] = [];

  for (const key of referenced) {
    const value = mergedMap[key];
    if (value === undefined || value === null || value === "") {
      missing.push(`{{${key}}}`);
    }
  }

  if (missing.length === 0) return null;

  return (
    `Email cannot be sent: the following template tokens have no value for this send: ` +
    `${missing.join(", ")}. ` +
    `Check that the required data exists on this record, or remove these tokens from the template.`
  );
}
