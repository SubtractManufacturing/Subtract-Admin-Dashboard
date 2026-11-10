import { describe, expect, it } from "vitest";
import {
  hasConvertingQuoteParts,
  planQuoteLineItemEdit,
  type EditableQuoteLine,
} from "./line-item-edit";

const line = (over: Partial<EditableQuoteLine> = {}): EditableQuoteLine => ({
  id: 1,
  quotePartId: "qp-1",
  name: "Bracket",
  quantity: 4,
  unitPrice: "25.00",
  totalPrice: "100.00",
  description: null,
  notes: null,
  ...over,
});

/** A part line (id 1, $100) plus a free-standing service line (id 2). */
const items = (service: Partial<EditableQuoteLine> = {}) => [
  line(),
  line({ id: 2, quotePartId: null, name: "Setup", quantity: 1, unitPrice: "10.00", totalPrice: "10.00", ...service }),
];

describe("planQuoteLineItemEdit", () => {
  it("ignores an edit to a line that is not on the quote", () => {
    expect(planQuoteLineItemEdit(items(), 99, "name", "X")).toEqual({ kind: "ignore" });
  });

  it("refuses a blank name and trims a real one", () => {
    expect(planQuoteLineItemEdit(items(), 1, "name", "   ")).toEqual({
      kind: "reject",
      message: "Name is required",
    });
    expect(planQuoteLineItemEdit(items(), 1, "name", "  Plate ")).toEqual({
      kind: "save",
      patch: { name: "Plate" },
      fields: { intent: "updateLineItem", lineItemId: "1", name: "Plate" },
    });
  });

  it("clears description and notes when emptied", () => {
    expect(planQuoteLineItemEdit(items(), 1, "description", "")).toEqual({
      kind: "save",
      patch: { description: null },
      fields: { intent: "updateLineItem", lineItemId: "1", description: "" },
    });
    expect(planQuoteLineItemEdit(items(), 1, "notes", "rush")).toMatchObject({
      patch: { notes: "rush" },
      fields: { notes: "rush" },
    });
  });

  it("recomputes the line total when the quantity changes", () => {
    expect(planQuoteLineItemEdit(items(), 1, "quantity", "6")).toEqual({
      kind: "save",
      patch: { quantity: 6, totalPrice: "150.00" },
      fields: {
        intent: "updateLineItem",
        lineItemId: "1",
        quantity: "6",
        totalPrice: "150.00",
      },
    });
  });

  it("ignores a quantity that is zero, negative or not a number", () => {
    for (const bad of ["0", "-2", "abc", ""]) {
      expect(planQuoteLineItemEdit(items(), 1, "quantity", bad)).toEqual({ kind: "ignore" });
    }
  });

  it("recomputes the line total when the unit price changes", () => {
    expect(planQuoteLineItemEdit(items(), 1, "unitPrice", "30")).toMatchObject({
      kind: "save",
      patch: { unitPrice: "30.00", totalPrice: "120.00" },
    });
  });

  it("back-computes the unit price when the line total changes", () => {
    expect(planQuoteLineItemEdit(items(), 1, "totalPrice", "90")).toEqual({
      kind: "save",
      patch: { totalPrice: "90.00", unitPrice: "22.50" },
      fields: {
        intent: "updateLineItem",
        lineItemId: "1",
        unitPrice: "22.50",
        totalPrice: "90.00",
      },
    });
  });

  it("turns a percentage on a service line into a discount off the other lines", () => {
    // The other line totals $100, so 20% is a -$20.00 line.
    expect(planQuoteLineItemEdit(items(), 2, "unitPrice", "20%")).toMatchObject({
      kind: "save",
      patch: { unitPrice: "-20.00", totalPrice: "-20.00" },
    });
    expect(planQuoteLineItemEdit(items(), 2, "totalPrice", "20%")).toMatchObject({
      kind: "save",
      patch: { totalPrice: "-20.00", unitPrice: "-20.00" },
    });
  });

  it("ignores a percentage or negative price on a part-linked line", () => {
    expect(planQuoteLineItemEdit(items(), 1, "unitPrice", "20%")).toEqual({ kind: "ignore" });
    expect(planQuoteLineItemEdit(items(), 1, "unitPrice", "-5")).toEqual({ kind: "ignore" });
    expect(planQuoteLineItemEdit(items(), 1, "totalPrice", "20%")).toEqual({ kind: "ignore" });
  });

  it("ignores a price that is blank or not a number", () => {
    expect(planQuoteLineItemEdit(items(), 2, "unitPrice", "")).toEqual({ kind: "ignore" });
    expect(planQuoteLineItemEdit(items(), 2, "unitPrice", "abc")).toEqual({ kind: "ignore" });
  });
});

describe("hasConvertingQuoteParts", () => {
  it("is true while any part is pending, queued or in progress", () => {
    for (const status of ["pending", "queued", "in_progress"]) {
      expect(
        hasConvertingQuoteParts([{ conversionStatus: "completed" }, { conversionStatus: status }]),
      ).toBe(true);
    }
  });

  it("is false once every part has settled, and for no parts", () => {
    expect(
      hasConvertingQuoteParts([
        { conversionStatus: "completed" },
        { conversionStatus: "failed" },
        { conversionStatus: null },
      ]),
    ).toBe(false);
    expect(hasConvertingQuoteParts([])).toBe(false);
    expect(hasConvertingQuoteParts(undefined)).toBe(false);
  });
});
