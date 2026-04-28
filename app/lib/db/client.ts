import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL ?? "";

/** Transaction pooler / PgBouncer (e.g. Supabase :6543) breaks prepared statements for some queries. */
const useTransactionPool =
  /pooler\.supabase\.com/i.test(connectionString) ||
  connectionString.includes(":6543");

// Disable SSL for local/CI Postgres (localhost, 127.0.0.1) or when DATABASE_SSL=false.
// All remote/Supabase connections still require SSL.
const isLocalHost = /localhost|127\.0\.0\.1/.test(connectionString);
const sslMode: "require" | false =
  isLocalHost || process.env.DATABASE_SSL === "false" ? false : "require";

export const client = postgres(connectionString, {
  ssl: sslMode,
  connect_timeout: 60,
  /** Per-session budget for slow networks; host may still enforce a lower cap. */
  connection: {
    application_name: "subtract-admin",
    statement_timeout: 60_000,
  },
  prepare: process.env.DATABASE_USE_PREPARE === "true" ? true : !useTransactionPool,
});
export const db = drizzle(client, { schema });