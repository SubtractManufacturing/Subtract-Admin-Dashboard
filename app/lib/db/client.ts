import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { getEnv } from "../env.server.js";
import {
  getAppDatabaseMaxConnections,
  isSupabaseSessionPooler,
} from "./connection-string.server.js";

const connectionString = getEnv("DATABASE_URL") ?? "";

/** Transaction pooler / PgBouncer (e.g. Supabase :6543) breaks prepared statements for some queries. */
const useTransactionPool =
  /pooler\.supabase\.com/i.test(connectionString) ||
  connectionString.includes(":6543");

// Disable SSL for local/CI Postgres (localhost, 127.0.0.1) or when DATABASE_SSL=false.
// All remote/Supabase connections still require SSL.
const isLocalHost = /localhost|127\.0\.0\.1/.test(connectionString);
const sslMode: "require" | false =
  isLocalHost || getEnv("DATABASE_SSL") === "false" ? false : "require";

if (
  isSupabaseSessionPooler(connectionString) &&
  !getEnv("DATABASE_DIRECT_URL")
) {
  console.warn(
    "[DB] DATABASE_URL uses Supabase session pooler without DATABASE_DIRECT_URL. " +
      "Set DATABASE_DIRECT_URL for pg-boss workers to avoid connection limit errors.",
  );
}

export const client = postgres(connectionString, {
  ssl: sslMode,
  max: getAppDatabaseMaxConnections(),
  connect_timeout: 60,
  /** Per-session budget for slow networks; host may still enforce a lower cap. */
  connection: {
    application_name: "subtract-admin",
    statement_timeout: 60_000,
  },
  prepare: getEnv("DATABASE_USE_PREPARE") === "true" ? true : !useTransactionPool,
});
export const db = drizzle(client, { schema });