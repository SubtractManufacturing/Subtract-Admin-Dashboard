import { describe, expect, it } from "vitest";
import {
  hasConvertingOrderParts,
  planOrderLineItemEdit,
  type EditableOrderLine,
} from "./line-item-edit";

const line = (over: Partial<EditableOrderLine> = {}): EditableOrderLine => ({
  id: 1,
  partId: "p-1",
  name: "Bracket",
  description: "6061",
  notes: null,
  quantity: 4,
  unitPrice: "25.00",
  ...over,
});

/** A part line (id 1, 4 x $25) plus a free-standing service line (id 2). */
const lines = () => [
  line(),
  line({ id: 2, partId: null, name: "Setup", description: null, quantity: 1, unitPrice: "10.00" }),
];

describe("planOrderLineItemEdit", () => {
  it("ignores an edit to a line that is not on the order", () => {
    expect(planOrderLineItemEdit(lines(), 99, "name", "X")).toEqual({ kind: "ignore" });
  });

  it("refuses a blank name", () => {
    expect(planOrderLineItemEdit(lines(), 1, "name", "  ")).toEqual({
      kind: "reject",
      message: "Name is required",
    });
  });

  it("posts the whole row with only the edited field changed", () => {
    expect(planOrderLineItemEdit(lines(), 1, "name", " Plate ")).toEqual({
      kind: "save",
      fields: {
        intent: "updateLineItem",
        lineItemId: "1",
        name: "Plate",
        description: "6061",
        notes: "",
        quantity: "4",
        unitPrice: "25.00",
        partId: "p-1",
      },
    });
  });

  it("omits the part id for a line with no part", () => {
    const plan = planOrderLineItemEdit(lines(), 2, "notes", "rush");
    expect(plan).toMatchObject({ kind: "save", fields: { notes: "rush", unitPrice: "10.00" } });
    expect(plan.kind === "save" && "partId" in plan.fields).toBe(false);
  });

  it("keeps the stored quantity when the new one is unusable", () => {
    expect(planOrderLineItemEdit(lines(), 1, "quantity", "7")).toMatchObject({
      fields: { quantity: "7" },
    });
    expect(planOrderLineItemEdit(lines(), 1, "quantity", "abc")).toMatchObject({
      fields: { quantity: "4" },
    });
    expect(planOrderLineItemEdit(lines(), 1, "quantity", "0")).toMatchObject({
      fields: { quantity: "4" },
    });
  });

  it("normalizes a unit price to two decimals", () => {
    expect(planOrderLineItemEdit(lines(), 1, "unitPrice", " 30 ")).toMatchObject({
      kind: "save",
      fields: { unitPrice: "30.00" },
    });
  });

  it("turns a percentage on a service line into a discount off the other lines", () => {
    // The other line extends to $100, so 20% is a -$20.00 unit price.
    expect(planOrderLineItemEdit(lines(), 2, "unitPrice", "20%")).toMatchObject({
      kind: "save",
      fields: { unitPrice: "-20.00" },
    });
  });

  it("explains why a price is refused", () => {
    expect(planOrderLineItemEdit(lines(), 1, "unitPrice", "20%")).toEqual({
      kind: "reject",
      message: "Percentage entry is not available on part-linked line items",
    });
    expect(planOrderLineItemEdit(lines(), 1, "unitPrice", "-5")).toEqual({
      kind: "reject",
      message: "Part-linked line items cannot have a negative unit price",
    });
    expect(planOrderLineItemEdit(lines(), 2, "unitPrice", "")).toEqual({
      kind: "reject",
      message: "Price is required",
    });
  });

  it("treats a missing stored unit price as zero", () => {
    expect(
      planOrderLineItemEdit([line({ unitPrice: null })], 1, "notes", "x"),
    ).toMatchObject({ fields: { unitPrice: "0" } });
  });
});

describe("hasConvertingOrderParts", () => {
  it("is true while any part is pending, queued or in progress", () => {
    for (const meshConversionStatus of ["pending", "queued", "in_progress"]) {
      expect(hasConvertingOrderParts([null, { meshConversionStatus }])).toBe(true);
    }
  });

  it("counts a part with a CAD file but no recorded conversion", () => {
    expect(
      hasConvertingOrderParts([{ partFileUrl: "parts/a.step", meshConversionStatus: null }]),
    ).toBe(true);
  });

  it("is false once every part has settled, and for lines without parts", () => {
    expect(
      hasConvertingOrderParts([
        null,
        { meshConversionStatus: "completed", partFileUrl: "parts/a.step" },
        { meshConversionStatus: "failed" },
        { meshConversionStatus: null, partFileUrl: null },
      ]),
    ).toBe(false);
    expect(hasConvertingOrderParts([])).toBe(false);
  });
});
