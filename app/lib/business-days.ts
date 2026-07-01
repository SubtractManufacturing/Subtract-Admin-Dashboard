/**
 * US Eastern business-day calculations with federal holidays.
 *
 * Storage: calendar dates are persisted as the UTC instant for midnight ET on
 * that calendar day (see fromAppCalendarDate). Reads use toAppCalendarDate.
 */
import Holidays from "date-holidays";

export const APP_TIMEZONE = "America/New_York" as const;

const usHolidays = new Holidays("US");

export type AppInstantInput = Date | string | number;

type EtParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
};

export function parseAppInstant(value: unknown): Date | null {
  let date: Date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    date = new Date(trimmed);
  } else if (typeof value === "number") {
    date = new Date(value);
  } else {
    return null;
  }

  return Number.isNaN(date.getTime()) ? null : date;
}

function requireAppInstant(value: AppInstantInput, context: string): Date {
  const date = parseAppInstant(value);
  if (!date) {
    throw new RangeError(`${context}: invalid date value`);
  }
  return date;
}

function getEtParts(instant: AppInstantInput): EtParts {
  const date = requireAppInstant(instant, "getEtParts");
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
  };
}

/** Normalize any instant to midnight ET on its ET calendar day. */
export function toAppCalendarDate(instant: AppInstantInput): Date {
  const { year, month, day } = getEtParts(instant);
  return fromAppCalendarDate(year, month, day);
}

/** ET calendar year/month/day for a stored or clicked instant. */
export function getAppCalendarParts(instant: AppInstantInput): {
  year: number;
  month: number;
  day: number;
} {
  const { year, month, day } = getEtParts(toAppCalendarDate(instant));
  return { year, month, day };
}

/** Parse `YYYY-MM-DD` as midnight ET on that calendar day (never UTC midnight). */
export function parseAppCalendarDateString(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`parseAppCalendarDateString: invalid date "${isoDate}"`);
  }
  return fromAppCalendarDate(
    Number(match[1]),
    Number(match[2]),
    Number(match[3])
  );
}

/** Format an instant as `YYYY-MM-DD` in ET. */
export function toAppCalendarDateIsoString(instant: AppInstantInput): string {
  const { year, month, day } = getAppCalendarParts(instant);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** UTC instant for midnight ET on the given calendar day (month 1–12). */
export function fromAppCalendarDate(
  year: number,
  month: number,
  day: number
): Date {
  for (let utcHour = 0; utcHour < 24; utcHour++) {
    const candidate = new Date(Date.UTC(year, month - 1, day, utcHour, 0, 0, 0));
    const parts = getEtParts(candidate);
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === 0
    ) {
      return candidate;
    }
  }
  return new Date(Date.UTC(year, month - 1, day, 5, 0, 0, 0));
}

function isWeekendEt(instant: AppInstantInput): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    weekday: "short",
  });
  const weekday = formatter.format(requireAppInstant(instant, "isWeekendEt"));
  return weekday === "Sat" || weekday === "Sun";
}

export function isBusinessDay(date: AppInstantInput): boolean {
  const calendar = toAppCalendarDate(date);
  if (isWeekendEt(calendar)) return false;
  const holiday = usHolidays.isHoliday(calendar);
  return !holiday || (Array.isArray(holiday) && holiday.length === 0);
}

export function getNextBusinessDay(date: AppInstantInput): Date {
  let current = toAppCalendarDate(date);
  do {
    current = addCalendarDays(current, 1);
  } while (!isBusinessDay(current));
  return current;
}

function addCalendarDays(instant: Date, days: number): Date {
  const { year, month, day } = getEtParts(instant);
  const base = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return toAppCalendarDate(base);
}

export function startOfTodayInAppTz(): Date {
  return toAppCalendarDate(new Date());
}

export function addBusinessDays(start: AppInstantInput, n: number): Date {
  if (n < 0) throw new Error("addBusinessDays: n must be >= 0");
  if (n === 0) return toAppCalendarDate(start);

  let current = toAppCalendarDate(start);
  let remaining = n;
  while (remaining > 0) {
    current = addCalendarDays(current, 1);
    if (isBusinessDay(current)) remaining--;
  }
  return current;
}

export function countBusinessDays(
  start: AppInstantInput,
  end: AppInstantInput
): number {
  const startCal = toAppCalendarDate(start);
  const endCal = toAppCalendarDate(end);
  if (endCal < startCal) return 0;

  let count = 0;
  let current = startCal;
  while (current <= endCal) {
    if (isBusinessDay(current)) count++;
    current = addCalendarDays(current, 1);
  }
  return count;
}

/** Signed business days from start to end (negative when end is before start). */
export function signedBusinessDaysBetween(
  start: AppInstantInput,
  end: AppInstantInput
): number {
  const startCal = toAppCalendarDate(start);
  const endCal = toAppCalendarDate(end);
  if (endCal.getTime() === startCal.getTime()) return 0;
  if (endCal < startCal) {
    return -countBusinessDays(endCal, startCal) + (isBusinessDay(endCal) ? 0 : 0);
  }
  return countBusinessDays(startCal, endCal) - (isBusinessDay(startCal) ? 1 : 0);
}

/**
 * Business days from start (ET calendar day) to end.
 * Same day → 0. End before start → negative count.
 */
export function businessDaysFrom(
  start: AppInstantInput,
  end: AppInstantInput
): number {
  const startCal = toAppCalendarDate(start);
  const endCal = toAppCalendarDate(end);
  if (endCal.getTime() === startCal.getTime()) return 0;
  if (endCal < startCal) {
    return -countBusinessDays(addCalendarDays(endCal, 1), startCal);
  }
  return countBusinessDays(startCal, endCal) - (isBusinessDay(startCal) ? 1 : 0);
}

/** Business days from today (ET) to target; negative if target is in the past. */
export function businessDaysUntil(target: AppInstantInput): number {
  return businessDaysFrom(startOfTodayInAppTz(), target);
}

export function formatLeadTimeBusinessDays(
  min: number,
  max?: number
): string {
  if (max == null || min === max) {
    return `${min} Business Day${min === 1 ? "" : "s"}`;
  }
  return `${min}–${max} Business Days`;
}

/** Map price-calculator lead time option to min/max business days. */
export function leadTimeOptionToBusinessDays(option: string): {
  min: number;
  max: number;
} {
  switch (option) {
    case "3-5 Days":
      return { min: 3, max: 5 };
    case "5-7 Days":
      return { min: 5, max: 7 };
    case "7-12 Days":
    default:
      return { min: 7, max: 12 };
  }
}
