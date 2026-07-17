import { readFileSync } from "node:fs";

const cache = new Map<string, string | undefined>();

function fileEnvName(name: string): string {
  return `${name}_FILE`;
}

function readSecretFile(name: string, filePath: string): string {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read ${fileEnvName(name)} at "${filePath}": ${detail}`,
    );
  }

  const value = raw.trim();
  if (!value) {
    throw new Error(
      `${fileEnvName(name)} at "${filePath}" is empty after trimming`,
    );
  }
  return value;
}

/**
 * Resolve an env var with Docker Swarm / Compose `*_FILE` support.
 * If `FOO_FILE` is a non-empty path, the file wins (no fallback to `FOO`).
 * Plain env may return `""`. Successful values and `undefined` are cached;
 * read errors are not.
 */
export function getEnv(name: string): string | undefined {
  if (cache.has(name)) {
    return cache.get(name);
  }

  const filePath = process.env[fileEnvName(name)];
  if (filePath !== undefined) {
    const trimmedPath = filePath.trim();
    if (!trimmedPath) {
      throw new Error(
        `${fileEnvName(name)} is set but empty; provide a file path or unset it`,
      );
    }
    // Errors are intentionally not cached so a retry can re-read.
    const value = readSecretFile(name, trimmedPath);
    cache.set(name, value);
    return value;
  }

  const value = process.env[name];
  cache.set(name, value);
  return value;
}

/**
 * Like getEnv, but throws if the resolved value is missing or whitespace-only.
 */
export function requireEnv(name: string): string {
  const value = getEnv(name);
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Clear the in-process cache. For tests that mutate process.env / secret files. */
export function clearEnvCache(): void {
  cache.clear();
}
