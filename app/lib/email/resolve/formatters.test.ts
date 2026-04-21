import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatDate,
  formatAddress,
  formatPartNames,
  formatPartSpecs,
} from "./formatters";

describe("formatCurrency", () => {
  it("returns null for null", () => {
    expect(formatCurrency(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(formatCurrency(undefined)).toBeNull();
  });

  it("returns null for a non-numeric string", () => {
    expect(formatCurrency("abc")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(formatCurrency("")).toBeNull();
  });

  it("formats a whole dollar amount", () => {
    const result = formatCurrency("1200.00");
    expect(result).toContain("$");
    expect(result).toContain("1,200");
  });

  it("formats a small amount with cents", () => {
    const result = formatCurrency("9.50");
    expect(result).toBe("$9.50");
  });

  it("formats zero", () => {
    const result = formatCurrency("0");
    expect(result).toBe("$0.00");
  });

  it("formats a large amount", () => {
    const result = formatCurrency("12345.67");
    expect(result).toContain("$");
    expect(result).toContain("12,345");
  });
});

describe("formatDate", () => {
  it("returns null for null", () => {
    expect(formatDate(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(formatDate(undefined)).toBeNull();
  });

  it("formats a UTC date as 'Month D, YYYY'", () => {
    const date = new Date(Date.UTC(2026, 0, 15)); // January 15, 2026
    const result = formatDate(date);
    expect(result).toContain("January");
    expect(result).toContain("15");
    expect(result).toContain("2026");
  });

  it("formats month correctly — March", () => {
    const date = new Date(Date.UTC(2026, 2, 3)); // March 3, 2026
    const result = formatDate(date);
    expect(result).toContain("March");
    expect(result).toContain("3");
  });

  it("uses UTC timezone (no off-by-one from local tz)", () => {
    // Midnight UTC Jan 1 — should still be January 1, not Dec 31 in any tz
    const date = new Date(Date.UTC(2026, 0, 1));
    const result = formatDate(date);
    expect(result).toContain("January");
    expect(result).toContain("1");
    expect(result).toContain("2026");
  });
});

describe("formatAddress", () => {
  it("returns null for all-empty object", () => {
    expect(formatAddress({})).toBeNull();
  });

  it("returns null when all fields are whitespace", () => {
    expect(formatAddress({ city: "  ", state: "", postalCode: " " })).toBeNull();
  });

  it("formats a full address", () => {
    const result = formatAddress({
      company: "Acme Corp",
      line1: "123 Main St",
      city: "Portland",
      state: "OR",
      postalCode: "97201",
    });
    expect(result).toBe("Acme Corp\n123 Main St\nPortland, OR 97201");
  });

  it("formats city+state+zip on one line", () => {
    const result = formatAddress({ city: "Austin", state: "TX", postalCode: "78701" });
    expect(result).toBe("Austin, TX 78701");
  });

  it("omits blank lines", () => {
    const result = formatAddress({ line1: "456 Oak Ave", city: "Denver", state: "CO" });
    expect(result).toBe("456 Oak Ave\nDenver, CO");
  });

  it("formats city+state without zip", () => {
    const result = formatAddress({ city: "Seattle", state: "WA" });
    expect(result).toBe("Seattle, WA");
  });

  it("formats zip only", () => {
    const result = formatAddress({ postalCode: "10001" });
    expect(result).toBe("10001");
  });

  it("includes line2 when present", () => {
    const result = formatAddress({
      line1: "100 Main St",
      line2: "Suite 200",
      city: "Boston",
      state: "MA",
    });
    expect(result).toContain("Suite 200");
  });
});

describe("formatPartNames", () => {
  it("returns null for empty array", () => {
    expect(formatPartNames([])).toBeNull();
  });

  it("returns a single part name", () => {
    expect(formatPartNames([{ name: "Bracket A" }])).toBe("Bracket A");
  });

  it("joins multiple part names with commas", () => {
    const result = formatPartNames([{ name: "Part 1" }, { name: "Part 2" }, { name: "Part 3" }]);
    expect(result).toBe("Part 1, Part 2, Part 3");
  });
});

describe("formatPartSpecs", () => {
  it("returns null for empty array", () => {
    expect(formatPartSpecs([])).toBeNull();
  });

  it("renders Name line for minimal part", () => {
    const result = formatPartSpecs([{ name: "Widget" }]);
    expect(result).toBe("Name: Widget");
  });

  it("renders all available fields", () => {
    const result = formatPartSpecs([
      { name: "Bracket", material: "4140", tolerance: "+/-0.005\"", finishing: "Anodized" },
    ]);
    expect(result).toContain("Name: Bracket");
    expect(result).toContain("Material: 4140");
    expect(result).toContain("Tolerance: +/-0.005\"");
    expect(result).toContain("Finishing: Anodized");
  });

  it("separates multiple parts with a blank line", () => {
    const result = formatPartSpecs([{ name: "A" }, { name: "B" }]);
    expect(result).toBe("Name: A\n\nName: B");
  });

  it("omits blank/whitespace-only fields", () => {
    const result = formatPartSpecs([{ name: "Widget", material: "  " }]);
    expect(result).not.toContain("Material:");
  });
});
