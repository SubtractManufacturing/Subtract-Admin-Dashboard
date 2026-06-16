import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Prefer session pooler (DATABASE_URL) — see getQueueDatabaseUrl() for pg-boss.
    url: process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL!,
  },
});
