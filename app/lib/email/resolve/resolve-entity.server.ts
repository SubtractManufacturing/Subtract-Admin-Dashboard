/**
 * Server-only: resolves merge tokens for a given entity (DB / server APIs).
 *
 * @see docs/email-template-merge-tokens.md
 */

import type { EntityKind, ResolvedTokenMap } from "./types";
import { resolveCustomerTokens } from "./customer.server";
import { resolveOrderTokens } from "./order.server";
import { resolveQuoteTokens } from "./quote.server";
import { resolveVendorTokens } from "./vendor.server";

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
