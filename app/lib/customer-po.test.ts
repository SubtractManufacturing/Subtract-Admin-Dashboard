import { describe, expect, it } from "vitest";
import {
  isAllowedCustomerPoFile,
  normalizePoNumber,
} from "./customer-po";

describe("normalizePoNumber", () => {
  it("returns trimmed PO when present", () => {
    expect(normalizePoNumber("PO-100")).toBe("PO-100");
    expect(normalizePoNumber("  PO-100  ")).toBe("PO-100");
  });

  it("returns null when missing or blank", () => {
    expect(normalizePoNumber(null)).toBeNull();
    expect(normalizePoNumber(undefined)).toBeNull();
    expect(normalizePoNumber("")).toBeNull();
    expect(normalizePoNumber("   ")).toBeNull();
  });
});

describe("isAllowedCustomerPoFile", () => {
  it("allows PDF and common image types", () => {
    expect(isAllowedCustomerPoFile("application/pdf", "po.pdf")).toBe(true);
    expect(isAllowedCustomerPoFile("image/png", "scan.png")).toBe(true);
    expect(isAllowedCustomerPoFile("image/jpeg", "scan.jpg")).toBe(true);
    expect(isAllowedCustomerPoFile("image/webp", "scan.webp")).toBe(true);
  });

  it("allows by extension when mime is missing or generic", () => {
    expect(isAllowedCustomerPoFile("", "customer-po.PDF")).toBe(true);
    expect(isAllowedCustomerPoFile("application/octet-stream", "po.jpg")).toBe(
      true,
    );
  });

  it("rejects unsupported types", () => {
    expect(isAllowedCustomerPoFile("application/zip", "po.zip")).toBe(false);
    expect(isAllowedCustomerPoFile("text/plain", "notes.txt")).toBe(false);
    expect(isAllowedCustomerPoFile("", "no-extension")).toBe(false);
  });
});
