/**
 * Postgres URL for pg-boss and other long-lived DB clients.
 * In dev, prefer DATABASE_URL (session pooler) — Supabase direct host is often IPv6-only.
 * In production, prefer DATABASE_DIRECT_URL when set.
 */
export function getQueueDatabaseUrl(): string {
  const pooler = process.env.DATABASE_URL;
  const direct = process.env.DATABASE_DIRECT_URL;

  if (process.env.NODE_ENV !== "production") {
    return pooler || direct || "";
  }
  return direct || pooler || "";
}
