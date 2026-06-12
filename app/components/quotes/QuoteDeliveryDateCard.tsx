import { useState, useEffect, useRef } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import BusinessDayCalendar from "~/components/shared/BusinessDayCalendar";
import {
  addBusinessDays,
  countBusinessDays,
  formatLeadTimeBusinessDays,
  startOfTodayInAppTz,
} from "~/lib/business-days";
import { formatDateRangeForDisplay } from "~/lib/date-display";
import type { QuoteWithRelations } from "~/lib/quotes";

type QuoteDeliveryDateCardProps = {
  quote: QuoteWithRelations;
  variant?: "summary" | "editor" | "modal";
  readOnly?: boolean;
  startEditing?: boolean;
  onCancel?: () => void;
  onSaved?: () => void;
};

function computeRangeFromLeadTime(min: number, max: number) {
  const today = startOfTodayInAppTz();
  return {
    from: addBusinessDays(today, min),
    to: addBusinessDays(today, max),
  };
}

export default function QuoteDeliveryDateCard({
  quote,
  variant = "editor",
  readOnly = false,
  startEditing = false,
  onCancel,
  onSaved,
}: QuoteDeliveryDateCardProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const saveInitiated = useRef(false);
  const [editing, setEditing] = useState(startEditing);

  const initialMin = quote.leadTimeBusinessDaysMin ?? null;
  const initialMax = quote.leadTimeBusinessDaysMax ?? null;

  const [minDays, setMinDays] = useState(initialMin?.toString() ?? "");
  const [maxDays, setMaxDays] = useState(initialMax?.toString() ?? "");
  const [range, setRange] = useState<{ from: Date | null; to: Date | null }>(
    () => {
      if (initialMin != null && initialMax != null) {
        const r = computeRangeFromLeadTime(initialMin, initialMax);
        return { from: r.from, to: r.to };
      }
      if (quote.estimatedDeliveryDateStart && quote.estimatedDeliveryDateEnd) {
        return {
          from: new Date(quote.estimatedDeliveryDateStart),
          to: new Date(quote.estimatedDeliveryDateEnd),
        };
      }
      return { from: null, to: null };
    },
  );

  useEffect(() => {
    if (startEditing) {
      setEditing(true);
    }
  }, [startEditing]);

  useEffect(() => {
    if (initialMin != null && initialMax != null) {
      const r = computeRangeFromLeadTime(initialMin, initialMax);
      setRange({ from: r.from, to: r.to });
      setMinDays(String(initialMin));
      setMaxDays(String(initialMax));
    }
  }, [initialMin, initialMax]);

  useEffect(() => {
    if (fetcher.state === "submitting") {
      saveInitiated.current = true;
    }
    if (!saveInitiated.current || fetcher.state !== "idle") return;

    saveInitiated.current = false;
    if (fetcher.data?.success) {
      setEditing(false);
      revalidator.revalidate();
      onSaved?.();
    }
  }, [fetcher.state, fetcher.data, onSaved, revalidator]);

  const save = () => {
    const min = parseInt(minDays, 10);
    const max = parseInt(maxDays, 10);
    if (isNaN(min) || isNaN(max) || min < 0 || max < min) return;

    fetcher.submit(
      {
        intent: "updateEstimatedDelivery",
        leadTimeBusinessDaysMin: String(min),
        leadTimeBusinessDaysMax: String(max),
      },
      { method: "post" },
    );
  };

  const handleRangeChange = ({ from, to }: { from: Date; to: Date }) => {
    setRange({ from, to });
    const today = startOfTodayInAppTz();
    setMinDays(String(countBusinessDays(today, from)));
    setMaxDays(String(countBusinessDays(today, to)));
  };

  const handleRangeClear = () => {
    setRange({ from: null, to: null });
    setMinDays("");
    setMaxDays("");
  };

  const handleLeadTimeChange = (min: string, max: string) => {
    setMinDays(min);
    setMaxDays(max);
    const minN = parseInt(min, 10);
    const maxN = parseInt(max, 10);
    if (!isNaN(minN) && !isNaN(maxN) && minN >= 0 && maxN >= minN) {
      const r = computeRangeFromLeadTime(minN, maxN);
      setRange({ from: r.from, to: r.to });
    }
  };

  const hasLeadTime = initialMin != null && initialMax != null;
  const summaryDate =
    range.from && range.to
      ? formatDateRangeForDisplay(range.from, range.to, {
          includeTimeZoneLabel: false,
        })
      : null;
  const summaryLeadTime = hasLeadTime
    ? formatLeadTimeBusinessDays(initialMin!, initialMax!)
    : null;
  const draftMin = parseInt(minDays, 10);
  const draftMax = parseInt(maxDays, 10);
  const hasValidDraftRange =
    !isNaN(draftMin) &&
    !isNaN(draftMax) &&
    draftMin >= 0 &&
    draftMax >= draftMin;
  const draftLeadTime = hasValidDraftRange
    ? formatLeadTimeBusinessDays(draftMin, draftMax)
    : null;

  const cancel = () => {
    setEditing(false);
    onCancel?.();
  };

  if (variant === "summary") {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Estimated Delivery
        </h3>
        {hasLeadTime ? (
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {summaryDate ?? "—"}
          </p>
        ) : (
          <p className="text-gray-500 dark:text-gray-400">
            No estimated delivery set
          </p>
        )}
      </div>
    );
  }

  if (variant === "modal") {
    return (
      <form
        className="pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,23rem)_minmax(18rem,1fr)] lg:items-stretch">
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <BusinessDayCalendar
              mode="range"
              range={range}
              rangeBehavior="alternatingClicks"
              onRangeChange={handleRangeChange}
              onRangeClear={handleRangeClear}
            />
          </div>

          <div className="flex min-h-full flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Minimum Lead Time
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    value={minDays}
                    onChange={(e) =>
                      handleLeadTimeChange(e.target.value, maxDays)
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-16 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-500 dark:text-gray-400">
                    days
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Maximum Lead Time
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    value={maxDays}
                    onChange={(e) =>
                      handleLeadTimeChange(minDays, e.target.value)
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-16 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-500 dark:text-gray-400">
                    days
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Preview
              </p>
              <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Estimated Delivery
                  </dt>
                  <dd className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {summaryDate ?? "Select a range"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Lead Time
                  </dt>
                  <dd className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {draftLeadTime ?? "Enter a valid range"}
                  </dd>
                </div>
              </dl>
            </div>

            {!hasValidDraftRange && minDays !== "" && maxDays !== "" && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                Maximum lead time must be greater than or equal to minimum lead
                time.
              </p>
            )}

            <div className="mt-auto flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={cancel}
                className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!hasValidDraftRange || fetcher.state !== "idle"}
                className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {fetcher.state === "idle" ? "Save Lead Time" : "Saving..."}
              </button>
            </div>
          </div>
        </div>
      </form>
    );
  }

  return (
    <div
      id="estimated-delivery"
      className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700"
    >
      <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Estimated Delivery
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Set the quote lead time in business days. Dates shown are derived
              from today.
            </p>
          </div>
          {!readOnly && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="self-start sm:self-auto text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400"
            >
              {hasLeadTime ? "Edit" : "Set delivery"}
            </button>
          )}
        </div>
      </div>

      <div className="p-6">
        {!editing && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Estimated Delivery
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                {summaryDate ?? "Not set"}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Lead Time
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                {summaryLeadTime ?? "Not set"}
              </p>
            </div>
          </div>
        )}

        {editing ? (
          <div className="grid grid-cols-1 xl:grid-cols-[22rem_minmax(0,1fr)] gap-6">
            <div className="max-w-full overflow-x-auto">
              <BusinessDayCalendar
                mode="range"
                range={range}
                rangeBehavior="alternatingClicks"
                onRangeChange={handleRangeChange}
                onRangeClear={handleRangeClear}
              />
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Lead Time Min (Business Days)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={minDays}
                    onChange={(e) =>
                      handleLeadTimeChange(e.target.value, maxDays)
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Lead Time Max (Business Days)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={maxDays}
                    onChange={(e) =>
                      handleLeadTimeChange(minDays, e.target.value)
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 p-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Preview
                </p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">
                  {summaryDate ?? "Select a delivery range"}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {minDays && maxDays
                    ? formatLeadTimeBusinessDays(
                        parseInt(minDays, 10),
                        parseInt(maxDays, 10),
                      )
                    : "Enter business-day lead time"}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={save}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
