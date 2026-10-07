import { useState } from "react";

import Button from "~/components/shared/Button";
import {
  REASON_LABELS,
  defaultSurvivorId,
  type DuplicateGroupView,
} from "~/lib/customer-merge-view";

type Props = {
  group: DuplicateGroupView;
  onReview: (survivorId: number, mergedId: number) => void;
  onDismiss: (customerIds: number[]) => void;
  onUndismiss?: (customerIdA: number, customerIdB: number) => void;
};

const plural = (count: number, singular: string) =>
  `${count} ${singular}${count === 1 ? "" : "s"}`;

function formatDate(value: string | Date | null) {
  return value ? new Date(value).toLocaleDateString("en-US") : "No activity";
}

/** One suggested duplicate group: pick a survivor, review a merge, or dismiss. */
export function DuplicateGroupCard({ group, onReview, onDismiss, onUndismiss }: Props) {
  const [survivorId, setSurvivorId] = useState(() => defaultSurvivorId(group.customers));
  const nameOf = (id: number) =>
    group.customers.find((customer) => customer.id === id)?.displayName ?? `#${id}`;
  const survivor = group.customers.find((customer) => customer.id === survivorId);

  return (
    <article className="rounded-lg border border-gray-300 bg-white p-5 dark:border-gray-600 dark:bg-gray-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-2" aria-label="Why these were suggested">
          {group.reasons.map((reason) => (
            <li
              key={`${reason.kind}:${reason.value}`}
              className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-200"
            >
              {`${REASON_LABELS[reason.kind]}: ${reason.value}`}
            </li>
          ))}
        </ul>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onDismiss(group.customers.map((customer) => customer.id))}
        >
          Not duplicates
        </Button>
      </div>

      <ul className="divide-y divide-gray-200 dark:divide-gray-700">
        {group.customers.map((customer) => (
          <li key={customer.id} className="flex flex-wrap items-center gap-4 py-3">
            <label className="flex flex-1 cursor-pointer items-start gap-3">
              <input
                type="radio"
                name={`survivor-${group.customers[0].id}`}
                checked={survivorId === customer.id}
                onChange={() => setSurvivorId(customer.id)}
                className="mt-1"
                aria-label={`Keep ${customer.displayName}`}
              />
              <span>
                <span className="block font-semibold text-gray-900 dark:text-gray-100">
                  {customer.displayName}
                </span>
                <span className="block text-sm text-gray-600 dark:text-gray-400">
                  {[customer.companyName, customer.contactName, customer.email, customer.phone]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="block text-sm text-gray-600 dark:text-gray-400">
                  {`${plural(customer.quoteCount, "Quote")} · ${plural(customer.orderCount, "Order")}`}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-500">
                  Last activity: {formatDate(customer.lastActivityAt)}
                </span>
              </span>
            </label>
            {customer.id !== survivorId && survivor && (
              <Button
                type="button"
                size="sm"
                onClick={() => onReview(survivorId, customer.id)}
              >
                {`Merge ${customer.displayName} into ${survivor.displayName}`}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {group.dismissedPairs.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-gray-200 pt-3 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
          {group.dismissedPairs.map((pair) => {
            const pairLabel = `${nameOf(pair.lowCustomerId)} and ${nameOf(pair.highCustomerId)}`;
            return (
              <li key={`${pair.lowCustomerId}:${pair.highCustomerId}`} className="flex items-center gap-3">
                <span>
                  {`${pairLabel} dismissed by ${pair.dismissedByLabel ?? "unknown"} on ${formatDate(pair.dismissedAt)}`}
                </span>
                {onUndismiss && (
                  <button
                    type="button"
                    className="text-blue-600 underline dark:text-blue-400"
                    aria-label={`Undo dismissal of ${pairLabel}`}
                    onClick={() => onUndismiss(pair.lowCustomerId, pair.highCustomerId)}
                  >
                    Undo
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
