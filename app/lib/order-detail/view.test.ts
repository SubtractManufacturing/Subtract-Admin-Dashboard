import { describe, expect, it } from "vitest";
import {
  deliveryBanner,
  formatOrderDate,
  formatOrderMoney,
  orderPriority,
  orderPriorityBadgeClasses,
  orderProgress,
  orderStatusBadgeClasses,
  orderStatusLabel,
  vendorPayPercentage,
} from "./view";

describe("orderPriority", () => {
  it.each([
    [null, "Normal"],
    [-3, "Critical"],
    [0, "Critical"],
    [1, "High"],
    [5, "High"],
    [6, "Normal"],
    [30, "Normal"],
  ] as const)("%s business days -> %s", (days, expected) => {
    expect(orderPriority(days)).toBe(expected);
  });
});

describe("deliveryBanner", () => {
  it("always warns when no delivery date is set", () => {
    expect(deliveryBanner(null)).toEqual({
      show: true,
      color: "amber",
      message: "No Delivery Date set. Set a Delivery Date to track this order.",
    });
  });

  it("stays hidden beyond five business days", () => {
    expect(deliveryBanner({ businessDays: 6, dateLabel: "x" })).toEqual({
      show: false,
      color: "none",
      message: "",
    });
  });

  it("warns orange inside five business days, pluralising correctly", () => {
    expect(deliveryBanner({ businessDays: 5, dateLabel: "3/9/2026" })).toEqual({
      show: true,
      color: "orange",
      message: "Delivery Date is in 5 business days (3/9/2026)",
    });
    expect(deliveryBanner({ businessDays: 1, dateLabel: "3/9/2026" }).message).toBe(
      "Delivery Date is in 1 business day (3/9/2026)",
    );
  });

  it("is red on the day and when overdue", () => {
    expect(deliveryBanner({ businessDays: 0, dateLabel: "3/9/2026" })).toEqual({
      show: true,
      color: "red",
      message: "Delivery Date is today (3/9/2026)",
    });
    expect(deliveryBanner({ businessDays: -1, dateLabel: "d" }).message).toBe(
      "Delivery Date was 1 business day ago (d)",
    );
    expect(deliveryBanner({ businessDays: -4, dateLabel: "d" }).message).toBe(
      "Delivery Date was 4 business days ago (d)",
    );
  });
});

describe("status presentation", () => {
  it("labels multi-word statuses and capitalises the rest", () => {
    expect(orderStatusLabel("Waiting_For_Shop_Selection")).toBe("Waiting for Shop Selection");
    expect(orderStatusLabel("In_Production")).toBe("In Production");
    expect(orderStatusLabel("In_Inspection")).toBe("In Inspection");
    expect(orderStatusLabel("Shipped")).toBe("Shipped");
    expect(orderStatusLabel("pending")).toBe("Pending");
  });

  it("colours each status and defaults to gray", () => {
    expect(orderStatusBadgeClasses("Waiting_For_Shop_Selection")).toContain("purple");
    expect(orderStatusBadgeClasses("In_Production")).toContain("blue");
    expect(orderStatusBadgeClasses("In_Inspection")).toContain("amber");
    expect(orderStatusBadgeClasses("Shipped")).toContain("teal");
    expect(orderStatusBadgeClasses("Delivered")).toContain("green-600");
    expect(orderStatusBadgeClasses("Completed")).toContain("green-700");
    expect(orderStatusBadgeClasses("Cancelled")).toContain("red");
    expect(orderStatusBadgeClasses("Archived")).toContain("bg-gray-900");
    expect(orderStatusBadgeClasses("Pending")).toContain("gray-100");
    expect(orderStatusBadgeClasses("???")).toContain("gray-100");
  });

  it("colours priorities", () => {
    expect(orderPriorityBadgeClasses("Critical")).toContain("red");
    expect(orderPriorityBadgeClasses("High")).toContain("orange");
    expect(orderPriorityBadgeClasses("Normal")).toContain("green");
  });
});

describe("orderProgress", () => {
  it("climbs through the lifecycle", () => {
    const stages = [
      "Pending",
      "Waiting_For_Shop_Selection",
      "In_Production",
      "In_Inspection",
      "Shipped",
      "Delivered",
      "Completed",
    ].map(orderProgress);
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
    expect(stages[stages.length - 1]).toBe(100);
  });

  it("is zero for Cancelled and unknown, full for Archived", () => {
    expect(orderProgress("Cancelled")).toBe(0);
    expect(orderProgress("Mystery")).toBe(0);
    expect(orderProgress("Archived")).toBe(100);
  });
});

describe("vendorPayPercentage", () => {
  it("is the vendor share of the total", () => {
    expect(vendorPayPercentage("250", "1000")).toBe(25);
    expect(vendorPayPercentage(null, "1000")).toBe(0);
  });

  it("is zero without a positive total", () => {
    expect(vendorPayPercentage("250", "0")).toBe(0);
    expect(vendorPayPercentage("250", null)).toBe(0);
    expect(vendorPayPercentage("250", "-5")).toBe(0);
  });
});

describe("formatters", () => {
  it("formats money with thousands separators", () => {
    expect(formatOrderMoney("1234.5")).toBe("$1,234.50");
    expect(formatOrderMoney(null)).toBe("$0.00");
  });

  it("formats dates", () => {
    expect(formatOrderDate(null)).toBe("--");
    expect(formatOrderDate(new Date(2026, 2, 5, 12))).toBe("3/5/2026");
  });
});
