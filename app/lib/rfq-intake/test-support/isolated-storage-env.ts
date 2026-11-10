/**
 * The storage contract test creates buckets and writes and deletes objects, so it
 * must only ever run against a disposable local emulator. It reads its own
 * variables rather than S3_*, which on a developer machine point at real storage.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const REQUIRED = {
  endpoint: "RFQ_STORAGE_TEST_ENDPOINT",
  accessKeyId: "RFQ_STORAGE_TEST_ACCESS_KEY_ID",
  secretAccessKey: "RFQ_STORAGE_TEST_SECRET_ACCESS_KEY",
  appBucket: "RFQ_STORAGE_TEST_APP_BUCKET",
  intakeBucket: "RFQ_STORAGE_TEST_INTAKE_BUCKET",
} as const;

type EnvSource = Record<string, string | undefined>;

export type IsolatedStorageConfig = Record<keyof typeof REQUIRED, string> & {
  region: string;
};

/**
 * Windows treats env names case-insensitively, so process.env.S3_ENDPOINT finds a
 * variable written S3_Endpoint. Matching the exact key behaves the same everywhere.
 */
export function exactEnv(
  name: string,
  env: EnvSource = process.env,
): string | undefined {
  return Object.keys(env).includes(name) ? env[name]?.trim() || undefined : undefined;
}

/** Throws before any client exists unless a disposable endpoint is fully configured. */
export function resolveIsolatedStorageConfig(
  env: EnvSource = process.env,
): IsolatedStorageConfig {
  const entries = Object.entries(REQUIRED).map(
    ([key, name]) => [key, exactEnv(name, env)] as const,
  );
  const missing = Object.entries(REQUIRED)
    .filter(([key]) => !entries.find(([entry]) => entry === key)?.[1])
    .map(([, name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Storage contract test refused to run: set ${missing.join(", ")} for a disposable S3 emulator. S3_* settings are deliberately ignored.`,
    );
  }

  const config = Object.fromEntries(entries) as Record<keyof typeof REQUIRED, string>;
  let host: string;
  try {
    host = new URL(config.endpoint).hostname;
  } catch {
    throw new Error("Storage contract test refused to run: endpoint is not a valid URL.");
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Storage contract test refused to run: ${host} is not a local endpoint.`,
    );
  }
  if (config.appBucket === config.intakeBucket) {
    throw new Error(
      "Storage contract test refused to run: the app and intake buckets must differ.",
    );
  }
  return { ...config, region: exactEnv("RFQ_STORAGE_TEST_REGION", env) ?? "us-east-1" };
}
