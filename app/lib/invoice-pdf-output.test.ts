import { describe, expect, it } from "vitest";
import {
  getInvoiceDocumentTitle,
  resolveDefaultInvoicePresetId,
  resolveInvoiceGenerationMeta,
} from "./invoice-pdf-output";

describe("resolveDefaultInvoicePresetId", () => {
  it("defaults to order_confirmation when a PO number is set", () => {
    expect(resolveDefaultInvoicePresetId("PO-12345")).toBe("order_confirmation");
    expect(resolveDefaultInvoicePresetId("  PO-12345  ")).toBe(
      "order_confirmation",
    );
  });

  it("defaults to default when PO number is missing or blank", () => {
    expect(resolveDefaultInvoicePresetId(null)).toBe("default");
    expect(resolveDefaultInvoicePresetId(undefined)).toBe("default");
    expect(resolveDefaultInvoicePresetId("")).toBe("default");
    expect(resolveDefaultInvoicePresetId("   ")).toBe("default");
  });
});

describe("resolveInvoiceGenerationMeta", () => {
  it("maps order_confirmation preset to order_confirmation kind and filename", () => {
    expect(resolveInvoiceGenerationMeta("order_confirmation", "25Z00001")).toEqual({
      documentKind: "order_confirmation",
      filename: "Order-Confirmation-25Z00001.pdf",
    });
  });

  it("maps default and paid presets to invoice kind and filename", () => {
    expect(resolveInvoiceGenerationMeta("default", "25Z00001")).toEqual({
      documentKind: "invoice",
      filename: "Invoice-25Z00001.pdf",
    });
    expect(resolveInvoiceGenerationMeta("paid", "25Z00001")).toEqual({
      documentKind: "invoice",
      filename: "Invoice-25Z00001.pdf",
    });
  });

  it("falls back to invoice when preset is missing or unknown", () => {
    expect(resolveInvoiceGenerationMeta(null, "25Z00001")).toEqual({
      documentKind: "invoice",
      filename: "Invoice-25Z00001.pdf",
    });
    expect(resolveInvoiceGenerationMeta("nope", "25Z00001")).toEqual({
      documentKind: "invoice",
      filename: "Invoice-25Z00001.pdf",
    });
  });
});

describe("getInvoiceDocumentTitle", () => {
  it("returns ORDER CONFIRMATION for the order_confirmation preset", () => {
    expect(getInvoiceDocumentTitle("order_confirmation")).toBe("ORDER CONFIRMATION");
  });

  it("returns INVOICE for other presets", () => {
    expect(getInvoiceDocumentTitle("default")).toBe("INVOICE");
    expect(getInvoiceDocumentTitle("paid")).toBe("INVOICE");
  });
});
