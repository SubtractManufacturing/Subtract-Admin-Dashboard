import { useState } from "react";

import Button from "~/components/shared/Button";
import { MergeDirectionArrow } from "~/components/customers/MergeDirectionArrow";
import {
  REASON_LABELS,
  defaultSurvivorId,
  type CustomerSummaryView,
  type DuplicatePairView,
} from "~/lib/customer-merge-view";

type Props = {
  pair: DuplicatePairView;
  onReview: (survivorId: number, mergedId: number) => void;
};

const plural = (count: number, singular: string) =>
  `${count} ${singular}${count === 1 ? "" : "s"}`;

function formatDate(value: string | Date | null) {
  return value ? new Date(value).toLocaleDateString("en-US") : "No activity";
}

function CustomerPanel({
  customer,
  side,
}: {
  customer: CustomerSummaryView;
  side: "keep" | "merge";
}) {
  const details: Array<[string, string | null]> = [
    ["Company", customer.companyName],
    ["Contact", customer.contactName],
    ["Email", customer.email],
    ["Phone", customer.phone],
  ];
  return (
    <div
      className={`min-w-0 rounded-lg border p-4 transition-colors duration-300 ${
        side === "keep"
          ? "border-green-300 bg-green-50/60 dark:border-green-800 dark:bg-green-950/20"
          : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40"
      }`}
    >
      <span
        className={`mb-2 inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide transition-colors duration-300 ${
          side === "keep"
            ? "bg-green-600 text-white dark:bg-green-700"
            : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
        }`}
      >
        {side === "keep" ? "Keep" : "Merge in"}
      </span>
      <a
        href={`/customers/${customer.id}`}
        target="_blank"
        rel="noreferrer"
        className="block truncate font-semibold text-gray-900 hover:underline dark:text-gray-100"
        title={customer.displayName}
      >
        {customer.displayName}
      </a>
      <dl className="mt-2 space-y-0.5 text-sm">
        {details
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="w-16 shrink-0 text-gray-500 dark:text-gray-400">{label}</dt>
              <dd className="min-w-0 truncate text-gray-800 dark:text-gray-200" title={value ?? undefined}>
                {value}
              </dd>
            </div>
          ))}
      </dl>
      <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
        {`${plural(customer.quoteCount, "Quote")} · ${plural(customer.orderCount, "Order")}`}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Last activity: {formatDate(customer.lastActivityAt)}
      </p>
    </div>
  );
}

/**
 * One suggested duplicate pair. The cards stay put; the arrow points at the
 * Customer being kept and spins to reverse the merge.
 */
export function DuplicatePairCard({ pair, onReview }: Props) {
  const [keepSecond, setKeepSecond] = useState(
    () => defaultSurvivorId([pair.a, pair.b]) !== pair.a.id,
  );
  const keep = keepSecond ? pair.b : pair.a;
  const mergeIn = keepSecond ? pair.a : pair.b;

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3">
        <ul className="flex flex-wrap gap-2" aria-label="Why these were suggested">
          {pair.reasons.map((reason) => (
            <li
              key={`${reason.kind}:${reason.value}`}
              className="max-w-full truncate rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200"
              title={`${REASON_LABELS[reason.kind]}: ${reason.value}`}
            >
              {`${REASON_LABELS[reason.kind]}: ${reason.value}`}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <CustomerPanel customer={pair.a} side={keep.id === pair.a.id ? "keep" : "merge"} />
        <MergeDirectionArrow
          pointsToFirst={!keepSecond}
          onClick={() => setKeepSecond((current) => !current)}
          label={`Keep ${mergeIn.displayName} instead`}
        />
        <CustomerPanel customer={pair.b} side={keep.id === pair.b.id ? "keep" : "merge"} />
      </div>

      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          size="sm"
          aria-label={`Review merging ${mergeIn.displayName} into ${keep.displayName}`}
          onClick={() => onReview(keep.id, mergeIn.id)}
        >
          Review merge
        </Button>
      </div>
    </article>
  );
}
