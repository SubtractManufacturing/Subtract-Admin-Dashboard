/**
 * Postgres URLs and pool sizing for app vs queue clients.
 */

/** Supabase session pooler (:5432) caps total clients (often 15). */
export function isSupabaseSessionPooler(connectionString: string): boolean {
  return (
    /pooler\.supabase\.com/i.test(connectionString) &&
    /:5432(\/|$|\?)/.test(connectionString)
  );
}

/**
 * postgres.js pool size for Drizzle. Keep low on session pooler so web + worker
 * do not exhaust the shared Supabase connection budget.
 */
export function getAppDatabaseMaxConnections(): number {
  const configured = process.env.DATABASE_POOL_MAX;
  if (configured != null && configured !== "") {
    return Math.max(1, Number(configured) || 3);
  }

  const pooler = process.env.DATABASE_URL ?? "";
  return isSupabaseSessionPooler(pooler) ? 3 : 10;
}

/** pg-boss pool size — long-lived, keep minimal. */
export const PGBOSS_MAX_CONNECTIONS = 2;

/**
 * Postgres URL for pg-boss and other long-lived DB clients.
 * Prefer DATABASE_DIRECT_URL so queue workers do not compete with the app on
 * the Supabase session pooler connection limit.
 */
export function getQueueDatabaseUrl(): string {
  const pooler = process.env.DATABASE_URL;
  const direct = process.env.DATABASE_DIRECT_URL;

  return direct || pooler || "";
}
