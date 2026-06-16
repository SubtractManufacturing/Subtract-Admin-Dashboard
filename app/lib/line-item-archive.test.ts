import { describe, it, expect } from "vitest";
import { computeHardDeleteAt, formatArchiveExpiry } from "./line-item-archive";
import {
  LINE_ITEM_ARCHIVE_RETENTION_DEFAULT_DAYS,
  parseLineItemRetentionDaysInput,
} from "./developerSettings";

describe("line-item-archive helpers", () => {
  it("computeHardDeleteAt adds retention days", () => {
    const archivedAt = new Date("2026-01-01T12:00:00.000Z");
    const result = computeHardDeleteAt(archivedAt, 7);
    expect(result.toISOString()).toBe("2026-01-08T12:00:00.000Z");
  });

  it("computeHardDeleteAt handles month boundaries", () => {
    const archivedAt = new Date("2026-01-28T00:00:00.000Z");
    const result = computeHardDeleteAt(archivedAt, 7);
    expect(result.toISOString()).toBe("2026-02-04T00:00:00.000Z");
  });

  it("formatArchiveExpiry shows days when more than 24 hours remain", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const hardDeleteAt = new Date("2026-01-08T00:00:00.000Z");
    expect(formatArchiveExpiry(hardDeleteAt, now)).toBe("Expires in 7 days");
  });

  it("formatArchiveExpiry shows hours when under 24 hours remain", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const hardDeleteAt = new Date("2026-01-01T05:00:00.000Z");
    expect(formatArchiveExpiry(hardDeleteAt, now)).toBe("Expires in 5 hours");
  });

  it("formatArchiveExpiry shows Expired when past due", () => {
    const now = new Date("2026-01-02T00:00:00.000Z");
    const hardDeleteAt = new Date("2026-01-01T00:00:00.000Z");
    expect(formatArchiveExpiry(hardDeleteAt, now)).toBe("Expired");
  });
});

describe("parseLineItemRetentionDaysInput", () => {
  it("accepts valid integers in range", () => {
    expect(parseLineItemRetentionDaysInput("7")).toEqual({ ok: true, days: 7 });
  });

  it("rejects empty input", () => {
    expect(parseLineItemRetentionDaysInput("")).toEqual({
      ok: false,
      error: "Retention days is required",
    });
  });

  it("rejects non-integers", () => {
    expect(parseLineItemRetentionDaysInput("7.5").ok).toBe(false);
  });

  it("rejects out-of-range values", () => {
    expect(parseLineItemRetentionDaysInput("0").ok).toBe(false);
    expect(parseLineItemRetentionDaysInput("999").ok).toBe(false);
  });

  it("default constant matches product default", () => {
    expect(LINE_ITEM_ARCHIVE_RETENTION_DEFAULT_DAYS).toBe(7);
  });
});
