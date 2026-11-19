import { describe, expect, it } from "vitest";

import { parseDbTimestamp } from "./reconciliation.server";

describe("parseDbTimestamp", () => {
  it("reads a zone-less database timestamp as UTC", () => {
    expect(parseDbTimestamp("2026-11-19 02:31:05.123")?.toISOString()).toBe("2026-11-19T02:31:05.123Z");
  });
  it("keeps an explicit zone and passes Dates through", () => {
    expect(parseDbTimestamp("2026-11-19 02:31:05+02")?.toISOString()).toBe("2026-11-19T00:31:05.000Z");
    const date = new Date();
    expect(parseDbTimestamp(date)).toBe(date);
  });
  it("returns null for empty or invalid values", () => {
    expect(parseDbTimestamp(null)).toBeNull();
    expect(parseDbTimestamp("not a date")).toBeNull();
  });
});
