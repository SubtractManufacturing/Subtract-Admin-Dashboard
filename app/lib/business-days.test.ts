import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  businessDaysUntil,
  countBusinessDays,
  formatLeadTimeBusinessDays,
  fromAppCalendarDate,
  getNextBusinessDay,
  isBusinessDay,
  leadTimeOptionToBusinessDays,
  startOfTodayInAppTz,
  toAppCalendarDate,
} from "./business-days";

describe("business-days", () => {
  it("Friday + 1 business day → Monday", () => {
    const friday = fromAppCalendarDate(2026, 6, 12);
    const result = addBusinessDays(friday, 1);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    }).format(result);
    expect(parts).toBe("Mon");
  });

  it("skips weekends", () => {
    const friday = fromAppCalendarDate(2026, 6, 12);
    expect(isBusinessDay(friday)).toBe(true);
    const saturday = fromAppCalendarDate(2026, 6, 13);
    expect(isBusinessDay(saturday)).toBe(false);
    const sunday = fromAppCalendarDate(2026, 6, 14);
    expect(isBusinessDay(sunday)).toBe(false);
  });

  it("skips US federal holidays (2026 Independence Day weekend)", () => {
    const july2 = fromAppCalendarDate(2026, 7, 2);
    expect(isBusinessDay(july2)).toBe(true);
    const july3 = fromAppCalendarDate(2026, 7, 3);
    expect(isBusinessDay(july3)).toBe(false);
    const july4 = fromAppCalendarDate(2026, 7, 4);
    expect(isBusinessDay(july4)).toBe(false);
  });

  it("skips Thanksgiving 2026", () => {
    const thanksgiving = fromAppCalendarDate(2026, 11, 26);
    expect(isBusinessDay(thanksgiving)).toBe(false);
    const wedBefore = fromAppCalendarDate(2026, 11, 25);
    expect(isBusinessDay(wedBefore)).toBe(true);
  });

  it("addBusinessDays and countBusinessDays round-trip", () => {
    const start = fromAppCalendarDate(2026, 6, 1);
    const end = addBusinessDays(start, 10);
    expect(countBusinessDays(start, end)).toBe(11);
  });

  it("fromAppCalendarDate / toAppCalendarDate preserve ET calendar day", () => {
    const stored = fromAppCalendarDate(2026, 6, 15);
    const read = toAppCalendarDate(stored);
    expect(read.getTime()).toBe(stored.getTime());
  });

  it("getNextBusinessDay skips weekend", () => {
    const saturday = fromAppCalendarDate(2026, 6, 13);
    const next = getNextBusinessDay(saturday);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    }).format(next);
    expect(weekday).toBe("Mon");
  });

  it("formatLeadTimeBusinessDays single and range", () => {
    expect(formatLeadTimeBusinessDays(12)).toBe("12 Business Days");
    expect(formatLeadTimeBusinessDays(11, 13)).toBe("11–13 Business Days");
  });

  it("leadTimeOptionToBusinessDays maps calculator options", () => {
    expect(leadTimeOptionToBusinessDays("3-5 Days")).toEqual({ min: 3, max: 5 });
    expect(leadTimeOptionToBusinessDays("7-12 Days")).toEqual({ min: 7, max: 12 });
  });

  it("businessDaysUntil returns 0 for same day", () => {
    const today = startOfTodayInAppTz();
    expect(businessDaysUntil(today)).toBe(0);
  });

  it("rejects negative addBusinessDays", () => {
    expect(() => addBusinessDays(new Date(), -1)).toThrow();
  });
});
