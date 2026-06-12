import { describe, expect, it } from "vitest";
import { fromAppCalendarDate } from "./business-days";
import {
  formatDateForDisplay,
  formatDateRangeForDisplay,
  formatDateTimeForDisplay,
} from "./date-display";

describe("date-display", () => {
  it("formatDateForDisplay includes ET label", () => {
    const date = fromAppCalendarDate(2026, 6, 15);
    expect(formatDateForDisplay(date)).toBe("June 15, 2026 (ET)");
  });

  it("formatDateRangeForDisplay single day", () => {
    const date = fromAppCalendarDate(2026, 6, 15);
    expect(formatDateRangeForDisplay(date, date)).toBe("June 15, 2026 (ET)");
  });

  it("formatDateRangeForDisplay same month compact", () => {
    const start = fromAppCalendarDate(2026, 6, 15);
    const end = fromAppCalendarDate(2026, 6, 17);
    expect(formatDateRangeForDisplay(start, end)).toBe(
      "June 15–17, 2026 (ET)"
    );
  });

  it("formatDateTimeForDisplay includes ET label", () => {
    const date = fromAppCalendarDate(2026, 6, 15);
    const formatted = formatDateTimeForDisplay(date);
    expect(formatted).toContain("(ET)");
    expect(formatted).toContain("June 15, 2026");
  });
});
