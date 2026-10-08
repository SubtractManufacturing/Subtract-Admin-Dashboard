import { Link } from "@remix-run/react";
import { Check } from "lucide-react";

import {
  MATCH_FILTER_LABELS,
  MATCH_KINDS,
  type DuplicateReasonKind,
} from "~/lib/customer-merge-view";

type Props = {
  selected: DuplicateReasonKind[];
  /** Pairs sharing each signal, regardless of the current filters. */
  counts: Record<DuplicateReasonKind, number>;
  /** Where each chip goes: the current filters with that kind toggled. */
  hrefFor: (kinds: DuplicateReasonKind[]) => string;
};

/** Multi-select filter for the match algorithms. Selected kinds must ALL match. */
export function MatchFilterChips({ selected, counts, hrefFor }: Props) {
  return (
    <nav aria-label="Filter by match type" className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-gray-600 dark:text-gray-400">Match on</span>
      {MATCH_KINDS.map((kind) => {
        const active = selected.includes(kind);
        const next = active
          ? selected.filter((item) => item !== kind)
          : MATCH_KINDS.filter((item) => item === kind || selected.includes(item));
        return (
          <Link
            key={kind}
            to={hrefFor(next)}
            preventScrollReset
            replace
            aria-current={active ? "true" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
              active
                ? "border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-600"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {active && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {MATCH_FILTER_LABELS[kind]}{" "}
            <span
              className={`rounded-full px-1.5 text-xs ${
                active
                  ? "bg-white/25 text-white"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
              }`}
            >
              {counts[kind]}
            </span>
          </Link>
        );
      })}
      {selected.length > 0 && (
        <Link
          to={hrefFor([])}
          preventScrollReset
          replace
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          Clear
        </Link>
      )}
    </nav>
  );
}
