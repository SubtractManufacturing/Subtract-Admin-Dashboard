import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearEnvCache, getEnv, requireEnv } from "./env.server";

const TEST_VAR = "TEST_ENV_HELPER_VAR";
const TEST_FILE_VAR = `${TEST_VAR}_FILE`;

describe("env.server", () => {
  let tempDir: string;
  let prevValue: string | undefined;
  let prevFile: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "env-server-"));
    prevValue = process.env[TEST_VAR];
    prevFile = process.env[TEST_FILE_VAR];
    delete process.env[TEST_VAR];
    delete process.env[TEST_FILE_VAR];
    clearEnvCache();
  });

  afterEach(() => {
    clearEnvCache();
    if (prevValue === undefined) delete process.env[TEST_VAR];
    else process.env[TEST_VAR] = prevValue;
    if (prevFile === undefined) delete process.env[TEST_FILE_VAR];
    else process.env[TEST_FILE_VAR] = prevFile;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns plain env values including empty string", () => {
    process.env[TEST_VAR] = "from-env";
    expect(getEnv(TEST_VAR)).toBe("from-env");

    clearEnvCache();
    process.env[TEST_VAR] = "";
    expect(getEnv(TEST_VAR)).toBe("");
  });

  it("returns undefined when plain env is unset", () => {
    expect(getEnv(TEST_VAR)).toBeUndefined();
  });

  it("prefers file over plain env when FOO_FILE is set", () => {
    const secretPath = join(tempDir, "secret");
    writeFileSync(secretPath, "from-file\n", "utf8");
    process.env[TEST_VAR] = "from-env";
    process.env[TEST_FILE_VAR] = secretPath;
    expect(getEnv(TEST_VAR)).toBe("from-file");
  });

  it("trims trailing newline from secret files", () => {
    const secretPath = join(tempDir, "secret");
    writeFileSync(secretPath, "secret-value\r\n", "utf8");
    process.env[TEST_FILE_VAR] = secretPath;
    expect(getEnv(TEST_VAR)).toBe("secret-value");
  });

  it("throws when FOO_FILE path is empty or whitespace", () => {
    process.env[TEST_FILE_VAR] = "";
    expect(() => getEnv(TEST_VAR)).toThrow(/empty/);

    clearEnvCache();
    process.env[TEST_FILE_VAR] = "   ";
    expect(() => getEnv(TEST_VAR)).toThrow(/empty/);
  });

  it("throws when secret file is missing and does not fall back to env", () => {
    process.env[TEST_VAR] = "from-env";
    process.env[TEST_FILE_VAR] = join(tempDir, "missing");
    expect(() => getEnv(TEST_VAR)).toThrow(/Failed to read/);
  });

  it("throws when secret file is empty after trim", () => {
    const secretPath = join(tempDir, "empty");
    writeFileSync(secretPath, "  \n", "utf8");
    process.env[TEST_FILE_VAR] = secretPath;
    expect(() => getEnv(TEST_VAR)).toThrow(/empty after trimming/);
  });

  it("does not cache errors so a later successful read works", () => {
    const secretPath = join(tempDir, "late");
    process.env[TEST_FILE_VAR] = secretPath;
    expect(() => getEnv(TEST_VAR)).toThrow(/Failed to read/);

    writeFileSync(secretPath, "now-present\n", "utf8");
    expect(getEnv(TEST_VAR)).toBe("now-present");
  });

  it("caches successful values and undefined", () => {
    process.env[TEST_VAR] = "cached";
    expect(getEnv(TEST_VAR)).toBe("cached");
    process.env[TEST_VAR] = "changed";
    expect(getEnv(TEST_VAR)).toBe("cached");

    clearEnvCache();
    delete process.env[TEST_VAR];
    expect(getEnv(TEST_VAR)).toBeUndefined();
    process.env[TEST_VAR] = "after-miss";
    expect(getEnv(TEST_VAR)).toBeUndefined();
  });

  it("requireEnv rejects missing and whitespace-only values", () => {
    expect(() => requireEnv(TEST_VAR)).toThrow(/Missing required/);

    process.env[TEST_VAR] = "   ";
    clearEnvCache();
    expect(() => requireEnv(TEST_VAR)).toThrow(/Missing required/);

    clearEnvCache();
    process.env[TEST_VAR] = "ok";
    expect(requireEnv(TEST_VAR)).toBe("ok");
  });

  it("clearEnvCache allows re-resolution after env mutation", () => {
    process.env[TEST_VAR] = "one";
    expect(getEnv(TEST_VAR)).toBe("one");
    process.env[TEST_VAR] = "two";
    clearEnvCache();
    expect(getEnv(TEST_VAR)).toBe("two");
  });
});
