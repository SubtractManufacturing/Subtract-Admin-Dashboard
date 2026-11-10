import { describe, expect, it } from "vitest";
import {
  buildAttributeChangeEvents,
  diffAttributes,
  normalizeAttribute,
} from "./part-attribute-changes";

describe("normalizeAttribute", () => {
  it("trims and nulls empty values", () => {
    expect(normalizeAttribute("  6061-T6 ")).toBe("6061-T6");
    expect(normalizeAttribute("   ")).toBeNull();
    expect(normalizeAttribute("")).toBeNull();
    expect(normalizeAttribute(null)).toBeNull();
    expect(normalizeAttribute(undefined)).toBeNull();
  });

  it("ignores File entries", () => {
    expect(normalizeAttribute(new File(["x"], "x.txt"))).toBeNull();
  });
});

describe("diffAttributes", () => {
  const fields = ["material", "tolerance", "finish"] as const;

  it("reports only changed fields, in field order", () => {
    const changes = diffAttributes(
      fields,
      { material: "6061", tolerance: null, finish: "anodized" },
      { material: "7075", tolerance: null, finish: null },
    );
    expect(changes).toEqual([
      { field: "material", oldValue: "6061", newValue: "7075" },
      { field: "finish", oldValue: "anodized", newValue: null },
    ]);
  });

  it("treats null to null as unchanged", () => {
    expect(
      diffAttributes(
        fields,
        { material: null, tolerance: null, finish: null },
        { material: null, tolerance: null, finish: null },
      ),
    ).toEqual([]);
  });
});

describe("buildAttributeChangeEvents", () => {
  const actor = { userId: "u1", userEmail: "a@b.co" };

  it("builds quote-part events", () => {
    const [event] = buildAttributeChangeEvents({
      changes: [{ field: "material", oldValue: null, newValue: "6061" }],
      entityType: "quote",
      entityId: "7",
      eventTypePrefix: "quote_part",
      titlePrefix: "Quote Part",
      partName: "Bracket",
      metadata: { quotePartId: "qp1", quoteId: 7, quoteNumber: "Q-7" },
      actor,
    });
    expect(event).toEqual({
      entityType: "quote",
      entityId: "7",
      eventType: "quote_part_material_changed",
      eventCategory: "manufacturing",
      title: "Quote Part Material Changed",
      description: "Bracket changed to 6061",
      metadata: {
        partName: "Bracket",
        quotePartId: "qp1",
        quoteId: 7,
        quoteNumber: "Q-7",
        oldValue: null,
        newValue: "6061",
        field: "material",
      },
      userId: "u1",
      userEmail: "a@b.co",
    });
  });

  it("describes a cleared value and falls back to 'Part'", () => {
    const [event] = buildAttributeChangeEvents({
      changes: [{ field: "finishing", oldValue: "anodized", newValue: null }],
      entityType: "part",
      entityId: "p1",
      eventTypePrefix: "part",
      titlePrefix: "Part",
      partName: null,
      metadata: { orderId: 1 },
      actor,
    });
    expect(event.eventType).toBe("part_finishing_changed");
    expect(event.title).toBe("Part Finishing Changed");
    expect(event.description).toBe("Part changed to no finishing");
  });

  it("emits nothing when nothing changed", () => {
    expect(
      buildAttributeChangeEvents({
        changes: [],
        entityType: "part",
        entityId: "p1",
        eventTypePrefix: "part",
        titlePrefix: "Part",
        partName: "x",
        metadata: {},
        actor,
      }),
    ).toEqual([]);
  });
});
