import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;

/** Transaction pooler / PgBouncer (e.g. Supabase :6543) breaks prepared statements for some queries. */
const useTransactionPool =
  /pooler\.supabase\.com/i.test(connectionString) ||
  connectionString.includes(":6543");

// Supabase requires SSL
export const client = postgres(connectionString, {
  ssl: "require",
  connect_timeout: 60,
  /** Per-session budget for slow networks; host may still enforce a lower cap. */
  connection: {
    application_name: "subtract-admin",
    statement_timeout: 60_000,
  },
  prepare: process.env.DATABASE_USE_PREPARE === "true" ? true : !useTransactionPool,
});
export const db = drizzle(client, { schema });