import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  const prev = {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_FILE: process.env.DATABASE_URL_FILE,
    DATABASE_DIRECT_URL: process.env.DATABASE_DIRECT_URL,
    DATABASE_DIRECT_URL_FILE: process.env.DATABASE_DIRECT_URL_FILE,
    DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX,
    DATABASE_POOL_MAX_FILE: process.env.DATABASE_POOL_MAX_FILE,
  };

  beforeEach(() => {
    delete process.env.DATABASE_URL_FILE;
    delete process.env.DATABASE_DIRECT_URL_FILE;
    delete process.env.DATABASE_POOL_MAX_FILE;
    clearEnvCache();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearEnvCache();
  });

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
    process.env.DATABASE_URL = "postgresql://pooler:5432/db";
    process.env.DATABASE_DIRECT_URL = "postgresql://direct:5432/db";
    clearEnvCache();
    expect(getQueueDatabaseUrl()).toBe("postgresql://direct:5432/db");
  });

  it("uses a smaller default pool on session pooler", () => {
    delete process.env.DATABASE_POOL_MAX;
    process.env.DATABASE_URL =
      "postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres";
    clearEnvCache();
    expect(getAppDatabaseMaxConnections()).toBe(3);
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
