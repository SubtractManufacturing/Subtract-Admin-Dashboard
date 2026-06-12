import { useEffect, useState } from "react";
import { DayPicker, TZDate } from "react-day-picker";
import type { DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import {
  APP_TIMEZONE,
  getAppCalendarParts,
  isBusinessDay,
  startOfTodayInAppTz,
  toAppCalendarDate,
} from "~/lib/business-days";

type RangeBehavior = "default" | "alternatingClicks";

type BusinessDayCalendarProps =
  | {
      mode: "single";
      value?: Date | null;
      onChange?: (date: Date) => void;
      minDate?: Date;
    }
  | {
      mode: "range";
      range?: { from: Date | null; to: Date | null };
      onRangeChange?: (range: { from: Date; to: Date }) => void;
      onRangeClear?: () => void;
      minDate?: Date;
      rangeBehavior?: RangeBehavior;
    };

const rangeDayClassNames = {
  deliveryStart:
    "!bg-blue-600 !text-white rounded-full font-semibold hover:!bg-blue-700",
  deliveryEnd:
    "!bg-blue-600 !text-white rounded-full font-semibold hover:!bg-blue-700",
  deliveryMiddle:
    "!bg-blue-100 !text-blue-900 dark:!bg-blue-900/40 dark:!text-blue-100 rounded-none",
};

function toPickerDate(date: Date): TZDate {
  const { year, month, day } = getAppCalendarParts(date);
  return new TZDate(year, month - 1, day, APP_TIMEZONE);
}

function isPastDay(date: Date, minDate: Date): boolean {
  return toAppCalendarDate(date) < toAppCalendarDate(minDate);
}

function isDisabledDay(date: Date, minDate: Date): boolean {
  return !isBusinessDay(date) || isPastDay(date, minDate);
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return toAppCalendarDate(a).getTime() === toAppCalendarDate(b).getTime();
}

function isBetweenInclusive(date: Date, from: Date, to: Date): boolean {
  const t = toAppCalendarDate(date).getTime();
  const f = toAppCalendarDate(from).getTime();
  const e = toAppCalendarDate(to).getTime();
  const lo = Math.min(f, e);
  const hi = Math.max(f, e);
  return t >= lo && t <= hi;
}

function buildRangeModifiers(
  from: Date | null,
  to: Date | null,
): Record<string, Date | ((date: Date) => boolean) | undefined> {
  return {
    deliveryStart: (date: Date) =>
      from != null && sameCalendarDay(date, from),
    deliveryEnd: (date: Date) =>
      to != null &&
      from != null &&
      !sameCalendarDay(from, to) &&
      sameCalendarDay(date, to),
    deliveryMiddle: (date: Date) => {
      if (!from || !to || sameCalendarDay(from, to)) return false;
      if (sameCalendarDay(date, from) || sameCalendarDay(date, to)) {
        return false;
      }
      return isBetweenInclusive(date, from, to);
    },
  };
}

function AlternatingClickRangeCalendar({
  range,
  onRangeChange,
  onRangeClear,
  minDate,
}: {
  range?: { from: Date | null; to: Date | null };
  onRangeChange?: (range: { from: Date; to: Date }) => void;
  onRangeClear?: () => void;
  minDate: Date;
}) {
  const [clickCount, setClickCount] = useState(() =>
    range?.from && range?.to ? 2 : 0,
  );
  const from = range?.from ?? null;
  const to = range?.to ?? null;
  const [month, setMonth] = useState<Date>(
    () => to ?? from ?? minDate,
  );

  useEffect(() => {
    if (from && to) {
      setClickCount(2);
    } else if (!from && !to) {
      setClickCount(0);
    }
  }, [from?.getTime(), to?.getTime()]);

  useEffect(() => {
    if (to) {
      setMonth(to);
    } else if (from) {
      setMonth(from);
    }
  }, [from?.getTime(), to?.getTime()]);

  const disabled = (date: Date) => isDisabledDay(date, minDate);

  const handleDayActivate = (day: Date) => {
    if (isDisabledDay(day, minDate)) return;

    const clicked = toAppCalendarDate(day);
    const nextCount = clickCount + 1;
    setClickCount(nextCount);

    if (nextCount % 2 === 1) {
      const currentTo = to ? toAppCalendarDate(to) : clicked;
      const newTo =
        currentTo.getTime() < clicked.getTime() ? clicked : currentTo;
      onRangeChange?.({ from: clicked, to: newTo });
      return;
    }

    const currentFrom = from ? toAppCalendarDate(from) : clicked;
    const newFrom =
      clicked.getTime() < currentFrom.getTime() ? clicked : currentFrom;
    onRangeChange?.({ from: newFrom, to: clicked });
  };

  const handleClear = () => {
    setClickCount(0);
    onRangeClear?.();
  };

  return (
    <div className="space-y-3">
      <DayPicker
        timeZone={APP_TIMEZONE}
        month={toPickerDate(month)}
        onMonthChange={(nextMonth) => setMonth(toAppCalendarDate(nextMonth))}
        disabled={disabled}
        modifiers={{
          nonBusinessDay: (date) => !isBusinessDay(date),
          past: (date) => isPastDay(date, minDate),
          ...buildRangeModifiers(from, to),
        }}
        modifiersClassNames={{
          nonBusinessDay: "text-gray-400 dark:text-gray-500",
          past: "text-gray-300 dark:text-gray-600 opacity-50",
          ...rangeDayClassNames,
        }}
        onDayClick={(day, modifiers) => {
          if (modifiers.disabled || modifiers.hidden) return;
          handleDayActivate(day);
        }}
        onDayKeyDown={(day, modifiers, e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            if (modifiers.disabled || modifiers.hidden) return;
            handleDayActivate(day);
          }
        }}
        className="rounded-md border border-gray-200 dark:border-gray-700 p-2 bg-white dark:bg-gray-800"
      />
      <button
        type="button"
        onClick={handleClear}
        className="text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
      >
        Clear
      </button>
    </div>
  );
}

export default function BusinessDayCalendar(props: BusinessDayCalendarProps) {
  const minDate = props.minDate ?? startOfTodayInAppTz();

  const disabled = (date: Date) => isDisabledDay(date, minDate);

  const modifiers = {
    nonBusinessDay: (date: Date) => !isBusinessDay(date),
    past: (date: Date) => isPastDay(date, minDate),
  };

  const modifiersClassNames = {
    nonBusinessDay: "text-gray-400 dark:text-gray-500",
    past: "text-gray-300 dark:text-gray-600 opacity-50",
  };

  if (props.mode === "single") {
    return (
      <div className="space-y-2">
        <DayPicker
          mode="single"
          timeZone={APP_TIMEZONE}
          selected={props.value ? toPickerDate(props.value) : undefined}
          onSelect={(date) => {
            if (date) props.onChange?.(toAppCalendarDate(date));
          }}
          disabled={disabled}
          modifiers={modifiers}
          modifiersClassNames={modifiersClassNames}
          className="rounded-md border border-gray-200 dark:border-gray-700 p-2 bg-white dark:bg-gray-800"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Dates shown in Eastern Time (ET). Muted days are weekends or holidays.
        </p>
      </div>
    );
  }

  if (props.rangeBehavior === "alternatingClicks") {
    return (
      <AlternatingClickRangeCalendar
        range={props.range}
        onRangeChange={props.onRangeChange}
        onRangeClear={props.onRangeClear}
        minDate={minDate}
      />
    );
  }

  return (
    <div className="space-y-2">
      <DayPicker
        mode="range"
        timeZone={APP_TIMEZONE}
        selected={
          props.range?.from
            ? ({
                from: toPickerDate(props.range.from),
                to: props.range.to
                  ? toPickerDate(props.range.to)
                  : undefined,
              } as DateRange)
            : undefined
        }
        onSelect={(range) => {
          if (range?.from && range?.to) {
            props.onRangeChange?.({
              from: toAppCalendarDate(range.from),
              to: toAppCalendarDate(range.to),
            });
          }
        }}
        disabled={disabled}
        modifiers={modifiers}
        modifiersClassNames={modifiersClassNames}
        className="rounded-md border border-gray-200 dark:border-gray-700 p-2 bg-white dark:bg-gray-800"
      />
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Dates shown in Eastern Time (ET). Muted days are weekends or holidays.
      </p>
    </div>
  );
}
