import { describe, expect, it } from "vitest";

import { parseCustomerSortBy } from "./customer-sort";

describe("parseCustomerSortBy", () => {
  it("defaults to the current customer list sort when the URL param is missing", () => {
    expect(parseCustomerSortBy(null)).toBe("default");
  });

  it("accepts known customer sort values from the URL", () => {
    expect(parseCustomerSortBy("default")).toBe("default");
    expect(parseCustomerSortBy("recentOrders")).toBe("recentOrders");
    expect(parseCustomerSortBy("recentQuotes")).toBe("recentQuotes");
    expect(parseCustomerSortBy("name")).toBe("name");
  });

  it("falls back to the default sort for unknown URL values", () => {
    expect(parseCustomerSortBy("newestQuoteTotal")).toBe("default");
  });
});
