import { describe, expect, it } from "vitest";
import {
  parseJsonNumberArray,
  parsePositiveIntegerId,
  parseTrackingChanges,
  parseTrackingEntries,
  parseTrackingNumberUpdates,
} from "./tracking-form";

const form = (entries: Record<string, unknown>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, JSON.stringify(v));
  return fd;
};

describe("parsePositiveIntegerId", () => {
  it("accepts positive integers, numeric strings included", () => {
    expect(parsePositiveIntegerId(4, "ids")).toBe(4);
    expect(parsePositiveIntegerId(" 9 ", "ids")).toBe(9);
  });

  it.each([0, -1, 1.5, "x", null, undefined, ""])("rejects %s", (value) => {
    expect(() => parsePositiveIntegerId(value, "deletedIds")).toThrow(
      "deletedIds must contain only positive integer ids",
    );
  });
});

describe("parseJsonNumberArray", () => {
  it("is empty when the field is absent", () => {
    expect(parseJsonNumberArray(new FormData(), "deletedIds")).toEqual([]);
  });

  it("parses ids and rejects non-arrays and bad ids", () => {
    expect(parseJsonNumberArray(form({ deletedIds: [1, "2"] }), "deletedIds")).toEqual([1, 2]);
    expect(() => parseJsonNumberArray(form({ deletedIds: { a: 1 } }), "deletedIds")).toThrow(
      "deletedIds must be an array",
    );
    expect(() => parseJsonNumberArray(form({ deletedIds: [1, 0] }), "deletedIds")).toThrow();
  });

  it("throws on malformed JSON", () => {
    const fd = new FormData();
    fd.set("deletedIds", "[1,");
    expect(() => parseJsonNumberArray(fd, "deletedIds")).toThrow();
  });
});

describe("parseTrackingEntries", () => {
  it("trims numbers, keeps carrier info and drops blank or non-object rows", () => {
    const entries = parseTrackingEntries(
      form({
        newTrackingEntries: [
          { trackingNumber: "  1Z999 ", carrier: "ups", carrierDetails: { name: "UPS" } },
          { trackingNumber: "   " },
          "junk",
          null,
          { trackingNumber: "ABC", carrier: 5, carrierDetails: { name: 5 } },
        ],
      }),
      "newTrackingEntries",
    );
    expect(entries).toEqual([
      { trackingNumber: "1Z999", carrier: "ups", carrierDetails: { name: "UPS" } },
      { trackingNumber: "ABC", carrier: null, carrierDetails: null },
    ]);
  });
});

describe("parseTrackingNumberUpdates", () => {
  it("requires a valid id per row and skips blank numbers", () => {
    const updates = parseTrackingNumberUpdates(
      form({
        u: [
          { id: 3, trackingNumber: "NEW", carrier: "fedex" },
          { id: 4, trackingNumber: "  " },
        ],
      }),
      "u",
    );
    expect(updates).toEqual([
      { id: 3, trackingNumber: "NEW", carrier: "fedex", carrierDetails: null },
    ]);
    expect(() =>
      parseTrackingNumberUpdates(form({ u: [{ id: "x", trackingNumber: "N" }] }), "u"),
    ).toThrow("u.id must contain only positive integer ids");
  });
});

describe("parseTrackingChanges", () => {
  it("reads the three fields the modal posts", () => {
    const changes = parseTrackingChanges(
      form({
        newTrackingEntries: [{ trackingNumber: "A" }],
        deletedIds: [7],
        updatedTrackingEntries: [{ id: 2, trackingNumber: "B" }],
      }),
    );
    expect(changes.added).toHaveLength(1);
    expect(changes.deletedIds).toEqual([7]);
    expect(changes.updated).toEqual([
      { id: 2, trackingNumber: "B", carrier: null, carrierDetails: null },
    ]);
  });

  it("is empty for an empty form", () => {
    expect(parseTrackingChanges(new FormData())).toEqual({
      added: [],
      deletedIds: [],
      updated: [],
    });
  });
});
