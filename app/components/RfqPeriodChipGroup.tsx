import { useSearchParams, useSubmit } from "@remix-run/react";

const OPTIONS = [
  { value: "1", label: "Today" },
  { value: "7", label: "7d" },
  { value: "14", label: "14d" },
  { value: "30", label: "30d" },
] as const;

/**
 * Dashboard-only: drives `period` URL param (aligned with loader + getDashboardStats).
 */
export default function RfqPeriodChipGroup() {
  const [searchParams] = useSearchParams();
  const submit = useSubmit();
  const current = searchParams.get("period") ?? "7";

  const handleSelect = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("period", value);
    submit(next, {
      method: "get",
      preventScrollReset: true,
      replace: true,
    });
  };

  return (
    <div
      role="radiogroup"
      aria-label="Quote activity window"
      className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden flex-shrink-0"
    >
      {OPTIONS.map((opt, i) => {
        const selected = current === opt.value;
        const borderCls =
          i > 0 ? "border-l border-gray-300 dark:border-gray-600" : "";
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => handleSelect(opt.value)}
            title={`${opt.label}${opt.value !== "1" ? " days" : ""}`}
            className={`px-3 py-2 text-sm font-semibold transition-colors min-w-0 whitespace-nowrap ${borderCls} ${
              selected
                ? "bg-blue-600 text-white"
                : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
