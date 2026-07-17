import { describe, expect, it } from "vitest";
import {
  formatToolpathQueueError,
} from "./toolpath-upload.server";
import {
  getAppDatabaseMaxConnections,
  getQueueDatabaseUrl,
  isSupabaseSessionPooler,
} from "./db/connection-string.server";
import { clearEnvCache } from "./env.server";

describe("connection-string.server", () => {
  it("detects Supabase session pooler on port 5432", () => {
    expect(
      isSupabaseSessionPooler(
        "postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
      ),
    ).toBe(true);
    expect(
      isSupabaseSessionPooler(
        "postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
      ),
    ).toBe(false);
  });

  it("prefers DATABASE_DIRECT_URL for pg-boss", () => {
    const prevPooler = process.env.DATABASE_URL;
    const prevDirect = process.env.DATABASE_DIRECT_URL;
    process.env.DATABASE_URL = "postgresql://pooler:5432/db";
    process.env.DATABASE_DIRECT_URL = "postgresql://direct:5432/db";
    clearEnvCache();
    expect(getQueueDatabaseUrl()).toBe("postgresql://direct:5432/db");
    process.env.DATABASE_URL = prevPooler;
    process.env.DATABASE_DIRECT_URL = prevDirect;
    clearEnvCache();
  });

  it("uses a smaller default pool on session pooler", () => {
    const prevPooler = process.env.DATABASE_URL;
    const prevMax = process.env.DATABASE_POOL_MAX;
    delete process.env.DATABASE_POOL_MAX;
    process.env.DATABASE_URL =
      "postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres";
    clearEnvCache();
    expect(getAppDatabaseMaxConnections()).toBe(3);
    process.env.DATABASE_URL = prevPooler;
    process.env.DATABASE_POOL_MAX = prevMax;
    clearEnvCache();
  });
});

describe("formatToolpathQueueError", () => {
  it("maps session pool exhaustion to a friendly message", () => {
    expect(
      formatToolpathQueueError(
        new Error(
          "(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15",
        ),
      ),
    ).toBe("Database connection limit reached. Wait a moment and try again.");
  });
});
