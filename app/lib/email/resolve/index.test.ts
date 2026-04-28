import { describe, it, expect, vi } from "vitest";

// Stub the DB client so this unit test file can import pure functions from
// resolve/index without requiring DATABASE_URL at module load time.
vi.mock("~/lib/db", () => ({ db: {} }));

import { extractPlaceholderKeys, validateMergeTokens } from "./index";

describe("extractPlaceholderKeys", () => {
  it("returns empty set for strings with no tokens", () => {
    const keys = extractPlaceholderKeys(["Hello world", "No tokens here"]);
    expect(keys.size).toBe(0);
  });

  it("extracts a single token", () => {
    const keys = extractPlaceholderKeys(["Hello {{name}}"]);
    expect(keys.has("name")).toBe(true);
    expect(keys.size).toBe(1);
  });

  it("extracts multiple tokens from one string", () => {
    const keys = extractPlaceholderKeys(["Hello {{name}} and {{x}}"]);
    expect(keys.has("name")).toBe(true);
    expect(keys.has("x")).toBe(true);
    expect(keys.size).toBe(2);
  });

  it("deduplicates tokens appearing more than once", () => {
    const keys = extractPlaceholderKeys(["{{a}} and {{a}} again"]);
    expect(keys.size).toBe(1);
    expect(keys.has("a")).toBe(true);
  });

  it("extracts tokens across multiple strings", () => {
    const keys = extractPlaceholderKeys(["{{quoteNumber}}", "{{customerName}} — {{total}}"]);
    expect(keys.has("quoteNumber")).toBe(true);
    expect(keys.has("customerName")).toBe(true);
    expect(keys.has("total")).toBe(true);
    expect(keys.size).toBe(3);
  });

  it("does not extract partial braces like {foo} or {{}}", () => {
    const keys = extractPlaceholderKeys(["{foo}", "{{}}", "{{ }}"]);
    // Only \w+ inside {{}} matches; spaces don't match \w+
    expect(keys.size).toBe(0);
  });

  it("returns empty set for empty array", () => {
    expect(extractPlaceholderKeys([]).size).toBe(0);
  });
});

describe("validateMergeTokens", () => {
  it("returns null when all referenced tokens are present and non-empty", () => {
    const result = validateMergeTokens(["{{a}} and {{b}}"], { a: "x", b: "y" });
    expect(result).toBeNull();
  });

  it("returns null when template has no tokens", () => {
    const result = validateMergeTokens(["Hello world"], { anything: "val" });
    expect(result).toBeNull();
  });

  it("returns an error string when a token is missing from the map", () => {
    const result = validateMergeTokens(["{{foo}}"], {});
    expect(result).not.toBeNull();
    expect(result).toContain("{{foo}}");
  });

  it("treats empty string value as missing", () => {
    const result = validateMergeTokens(["{{customerName}}"], { customerName: "" });
    expect(result).not.toBeNull();
    expect(result).toContain("{{customerName}}");
  });

  it("lists all missing tokens in the error message", () => {
    const result = validateMergeTokens(["{{a}} {{b}} {{c}}"], { b: "present" });
    expect(result).not.toBeNull();
    expect(result).toContain("{{a}}");
    expect(result).toContain("{{c}}");
    // b is present — should not appear in error
    expect(result).not.toContain("{{b}}");
  });

  it("checks across multiple template strings", () => {
    const result = validateMergeTokens(["{{subject}}", "{{body}}"], { subject: "Hi" });
    expect(result).not.toBeNull();
    expect(result).toContain("{{body}}");
  });

  it("returns null when template is empty array", () => {
    const result = validateMergeTokens([], {});
    expect(result).toBeNull();
  });
});
