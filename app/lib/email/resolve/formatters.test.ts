import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatDate,
  formatAddress,
  formatPartNames,
  formatPartSpecs,
  formatPartMaterials,
  formatPartQtys,
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

  it("formats a date as Month D, YYYY with ET label", () => {
    const date = new Date("2026-01-15T17:00:00.000Z");
    expect(formatDate(date)).toBe("January 15, 2026 (ET)");
  });

  it("formats month correctly — March", () => {
    const date = new Date("2026-03-03T17:00:00.000Z");
    expect(formatDate(date)).toBe("March 3, 2026 (ET)");
  });

  it("uses Eastern Time for calendar day boundaries", () => {
    const midnightUtc = new Date(Date.UTC(2026, 0, 1));
    expect(formatDate(midnightUtc)).toBe("December 31, 2025 (ET)");
    const noonEt = new Date("2026-01-01T17:00:00.000Z");
    expect(formatDate(noonEt)).toBe("January 1, 2026 (ET)");
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

  it("returns postal code alone when city and state are empty but zip is present", () => {
    expect(formatAddress({ city: "", state: "", postalCode: "55105" })).toBe("55105");
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

describe("formatPartMaterials", () => {
  it("returns null for empty array", () => {
    expect(formatPartMaterials([])).toBeNull();
  });

  it("joins trimmed materials", () => {
    expect(formatPartMaterials([{ name: "A", material: " 6061 " }])).toBe("6061");
  });

  it("uses placeholder for missing material without dropping positions", () => {
    const result = formatPartMaterials([
      { name: "A", material: "4140" },
      { name: "B", material: null },
      { name: "C", material: "PVC" },
    ]);
    expect(result).toBe("4140, —, PVC");
  });
});

describe("formatPartQtys", () => {
  it("returns null for empty array", () => {
    expect(formatPartQtys([])).toBeNull();
  });

  it("joins quantity as string", () => {
    expect(formatPartQtys([{ name: "A", quantity: 2 }, { name: "B", quantity: 14 }])).toBe("2, 14");
  });

  it("allows zero quantity", () => {
    expect(formatPartQtys([{ name: "A", quantity: 0 }])).toBe("0");
  });

  it("uses placeholder when quantity null or NaN", () => {
    expect(formatPartQtys([{ name: "A", quantity: null }, { name: "B", quantity: 1 }])).toBe("—, 1");
    expect(formatPartQtys([{ name: "A", quantity: Number.NaN }])).toBe("—");
  });
});
