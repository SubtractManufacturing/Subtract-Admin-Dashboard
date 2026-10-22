import { createHash } from "node:crypto";

import type { EmailContextKey } from "~/lib/email/email-context-registry";

/** Deterministic UUID-shaped key for system first-send dedupe (enqueue validation requires UUID format). */
export function stableOutboundIdempotencyKey(
  contextKey: EmailContextKey,
  entityType: string,
  entityId: string,
): string {
  const hash = createHash("sha256")
    .update(`outbound:${contextKey}:${entityType}:${entityId}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
