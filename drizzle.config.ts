import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { getEnv } from "./app/lib/env.server";

export default defineConfig({
  dialect: "postgresql",
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Prefer session pooler (DATABASE_URL) — see getQueueDatabaseUrl() for pg-boss.
    url: getEnv("DATABASE_URL") || getEnv("DATABASE_DIRECT_URL")!,
  },
});
