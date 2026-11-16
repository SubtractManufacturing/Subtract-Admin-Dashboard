import { describe, expect, it } from "vitest";
import { hasPendingMeshConversion, validateQuoteForAcceptance } from "./acceptance";

const ready = {
  total: "120.00",
  lineItems: [{ id: 1 }],
  parts: [{ conversionStatus: "completed", partFileUrl: "k" }],
};

describe("hasPendingMeshConversion", () => {
  it.each([
    ["in_progress", null, true],
    ["queued", null, true],
    ["pending", "quote-parts/x.step", true],
    ["pending", null, false],
    ["completed", "quote-parts/x.step", false],
    ["failed", "quote-parts/x.step", false],
    [null, "quote-parts/x.step", false],
  ])("status %s with file %s -> %s", (conversionStatus, partFileUrl, expected) => {
    expect(hasPendingMeshConversion({ conversionStatus, partFileUrl })).toBe(expected);
  });
});

describe("validateQuoteForAcceptance", () => {
  it("accepts a priced quote with converted parts", () => {
    expect(validateQuoteForAcceptance(ready)).toEqual([]);
  });

  it("requires a positive total", () => {
    for (const total of [null, "0", "0.00", "-5"]) {
      expect(validateQuoteForAcceptance({ ...ready, total })).toEqual([
        "Quote must have a valid total greater than $0. Please add pricing to line items.",
      ]);
    }
  });

  it("requires at least one line item", () => {
    expect(validateQuoteForAcceptance({ ...ready, lineItems: [] })).toEqual([
      "Quote must have at least one line item.",
    ]);
    expect(validateQuoteForAcceptance({ ...ready, lineItems: undefined })).toEqual([
      "Quote must have at least one line item.",
    ]);
  });

  it("blocks while any mesh conversion is pending and counts them", () => {
    const errors = validateQuoteForAcceptance({
      ...ready,
      parts: [
        { conversionStatus: "queued", partFileUrl: "a" },
        { conversionStatus: "in_progress", partFileUrl: "b" },
        { conversionStatus: "completed", partFileUrl: "c" },
      ],
    });
    expect(errors).toEqual([
      "Cannot accept quote while 2 part(s) have pending mesh conversions.",
    ]);
  });

  it("reports every problem at once", () => {
    const errors = validateQuoteForAcceptance({
      total: "0",
      lineItems: [],
      parts: [{ conversionStatus: "queued", partFileUrl: "a" }],
    });
    expect(errors).toHaveLength(3);
  });
});
