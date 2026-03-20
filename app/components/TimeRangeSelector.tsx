import { useSearchParams, useSubmit } from "@remix-run/react";

export type TimeRangeValue = "7d" | "14d" | "30d" | "90d" | "all";

export const TIME_RANGE_OPTIONS: { value: TimeRangeValue; label: string }[] = [
  { value: "7d", label: "7 Days" },
  { value: "14d", label: "14 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "all", label: "All Time" },
];

export const DEFAULT_TIME_RANGE: TimeRangeValue = "30d";

interface TimeRangeSelectorProps {
  paramName?: string;
  className?: string;
}

/**
 * Convert time range string to a Date object representing the start date
 */
export function getTimeRangeStartDate(range: TimeRangeValue): Date | null {
  if (range === "all") return null;
  
  const now = new Date();
  const daysMap: Record<Exclude<TimeRangeValue, "all">, number> = {
    "7d": 7,
    "14d": 14,
    "30d": 30,
    "90d": 90,
  };
  
  now.setDate(now.getDate() - daysMap[range as Exclude<TimeRangeValue, "all">]);
  return now;
}

/**
 * Parse a string to a valid TimeRangeValue, with fallback
 */
export function parseTimeRange(value: string | null): TimeRangeValue {
  if (!value) return DEFAULT_TIME_RANGE;
  const validValues = TIME_RANGE_OPTIONS.map(opt => opt.value);
  return validValues.includes(value as TimeRangeValue) 
    ? (value as TimeRangeValue) 
    : DEFAULT_TIME_RANGE;
}

export default function TimeRangeSelector({ 
  paramName = "range",
  className = ""
}: TimeRangeSelectorProps) {
  const [searchParams] = useSearchParams();
  const submit = useSubmit();
  
  const currentValue = parseTimeRange(searchParams.get(paramName));

  const handleChange = (value: TimeRangeValue) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set(paramName, value);
    submit(newParams, {
      method: "get",
      preventScrollReset: true,
      replace: true,
    });
  };

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {TIME_RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => handleChange(option.value)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors duration-150 ${
            currentValue === option.value
              ? "bg-blue-600 text-white dark:bg-blue-500"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
