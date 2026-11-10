import { describe, expect, it } from "vitest";
import {
  parseQuantity,
  parseQuoteLineItemUpdate,
  readNewQuoteLineItemFields,
} from "./line-item-form";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const standalone = { quantity: 4, quotePartId: null, positiveSubtotal: 1000 };
const partLinked = { ...standalone, quotePartId: "qp-1" };

describe("parseQuantity", () => {
  it("accepts positive integers only", () => {
    expect(parseQuantity("3")).toBe(3);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("-2")).toBeNull();
    expect(parseQuantity("x")).toBeNull();
    expect(parseQuantity(null)).toBeNull();
  });
});

describe("parseQuoteLineItemUpdate", () => {
  it("touches only the fields that were posted", () => {
    const result = parseQuoteLineItemUpdate(form({ name: "  Setup fee " }), standalone);
    expect(result).toEqual({ ok: true, value: { name: "Setup fee" } });
  });

  it("changes quantity and re-prices per unit", () => {
    const result = parseQuoteLineItemUpdate(
      form({ quantity: "10", unitPrice: "2.5" }),
      standalone,
    );
    expect(result).toEqual({ ok: true, value: { quantity: 10, unitPrice: 2.5 } });
  });

  it("rejects a bad quantity", () => {
    for (const quantity of ["0", "-1", "abc"]) {
      expect(parseQuoteLineItemUpdate(form({ quantity }), standalone)).toEqual({
        ok: false,
        error: "Invalid quantity",
      });
    }
  });

  it("derives unit price from an extended total using the new quantity", () => {
    const result = parseQuoteLineItemUpdate(
      form({ quantity: "5", totalPrice: "100" }),
      standalone,
    );
    expect(result).toEqual({ ok: true, value: { quantity: 5, unitPrice: 20 } });
  });

  it("prefers totalPrice over unitPrice", () => {
    const result = parseQuoteLineItemUpdate(
      form({ totalPrice: "80", unitPrice: "999" }),
      standalone,
    );
    expect(result).toEqual({ ok: true, value: { unitPrice: 20 } });
  });

  it("turns a percent entry into a negative unit price off the subtotal", () => {
    const result = parseQuoteLineItemUpdate(form({ unitPrice: "10%" }), {
      ...standalone,
      quantity: 1,
    });
    expect(result).toEqual({ ok: true, value: { unitPrice: -100 } });
  });

  it("forbids percent discounts and negatives on part-linked lines", () => {
    expect(parseQuoteLineItemUpdate(form({ unitPrice: "10%" }), partLinked)).toMatchObject({
      ok: false,
      error: "Percentage entry is not available on part-linked line items",
    });
    expect(parseQuoteLineItemUpdate(form({ unitPrice: "-3" }), partLinked)).toMatchObject({
      ok: false,
      error: "Part-linked line items cannot have a negative unit price",
    });
  });

  it("ignores blank price fields", () => {
    const result = parseQuoteLineItemUpdate(
      form({ unitPrice: "", totalPrice: "" }),
      standalone,
    );
    expect(result).toEqual({ ok: true, value: {} });
  });

  it("clears description and notes when posted empty", () => {
    const result = parseQuoteLineItemUpdate(form({ description: "", notes: "" }), standalone);
    expect(result).toEqual({ ok: true, value: { description: "", notes: "" } });
  });
});

describe("readNewQuoteLineItemFields", () => {
  it("reads strings, nulls blank attributes and picks up the file", () => {
    const fd = form({
      name: "Bracket",
      quantity: "2",
      unitPrice: "15",
      material: "6061",
      tolerance: "",
    });
    fd.set("file", new File(["x"], "b.step"));
    const fields = readNewQuoteLineItemFields(fd);
    expect(fields).toMatchObject({
      name: "Bracket",
      quantity: "2",
      unitPrice: "15",
      material: "6061",
      tolerance: null,
      finish: null,
      description: "",
    });
    expect(fields.file?.name).toBe("b.step");
  });

  it("has no file when none was posted", () => {
    expect(readNewQuoteLineItemFields(form({})).file).toBeNull();
  });
});
