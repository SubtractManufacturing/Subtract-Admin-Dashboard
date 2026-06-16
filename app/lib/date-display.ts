import { APP_TIMEZONE, toAppCalendarDate } from "./business-days";

export const APP_TIMEZONE_LABEL = "ET";

type DateDisplayOptions = {
  includeTimeZoneLabel?: boolean;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const shortMonthFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  month: "long",
  day: "numeric",
});

function sameEtCalendarDay(a: Date, b: Date): boolean {
  return toAppCalendarDate(a).getTime() === toAppCalendarDate(b).getTime();
}

function appendTimeZoneLabel(
  value: string,
  options: DateDisplayOptions = {}
): string {
  return options.includeTimeZoneLabel === false
    ? value
    : `${value} (${APP_TIMEZONE_LABEL})`;
}

export function formatDateForDisplay(
  date: Date | null | undefined,
  options: DateDisplayOptions = {}
): string | null {
  if (date == null) return null;
  return appendTimeZoneLabel(dateFormatter.format(date), options);
}

export function formatDateRangeForDisplay(
  start: Date | null | undefined,
  end: Date | null | undefined,
  options: DateDisplayOptions = {}
): string | null {
  if (start == null || end == null) return null;
  if (sameEtCalendarDay(start, end)) {
    return formatDateForDisplay(start, options);
  }

  const startParts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(start);
  const endParts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(end);

  const get = (
    parts: Intl.DateTimeFormatPart[],
    type: Intl.DateTimeFormatPartTypes
  ) => parts.find((p) => p.type === type)?.value ?? "";

  const sy = get(startParts, "year");
  const sm = get(startParts, "month");
  const sd = get(startParts, "day");
  const ey = get(endParts, "year");
  const em = get(endParts, "month");
  const ed = get(endParts, "day");

  if (sy === ey && sm === em) {
    return appendTimeZoneLabel(`${sm} ${sd}–${ed}, ${sy}`, options);
  }
  if (sy === ey) {
    return appendTimeZoneLabel(
      `${shortMonthFormatter.format(start)}–${shortMonthFormatter.format(end)}, ${sy}`,
      options
    );
  }
  return appendTimeZoneLabel(
    `${dateFormatter.format(start)}–${dateFormatter.format(end)}`,
    options
  );
}

export function formatDateTimeForDisplay(
  date: Date | null | undefined
): string | null {
  if (date == null) return null;
  return `${dateTimeFormatter.format(date)} (${APP_TIMEZONE_LABEL})`;
}
