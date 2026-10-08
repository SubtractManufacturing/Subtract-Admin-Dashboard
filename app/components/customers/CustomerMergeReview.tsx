import { useState } from "react";

import { MergeDirectionArrow } from "~/components/customers/MergeDirectionArrow";
import Button from "~/components/shared/Button";
import type {
  CustomerSummaryView,
  MergeFieldChoice,
  MergePreviewView,
} from "~/lib/customer-merge-view";

type Props = {
  preview: MergePreviewView;
  onConfirm: (choices: Record<string, MergeFieldChoice>) => void;
  onCancel: () => void;
  /** Flip which Customer is kept. Omit to hide the swap button. */
  onSwap?: () => void;
  isSubmitting?: boolean;
  error?: string | null;
};

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

const CELL_CLASSES =
  "block h-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors hover:bg-gray-50 " +
  "peer-checked:border-blue-600 peer-checked:bg-blue-50 peer-checked:ring-1 peer-checked:ring-blue-600 " +
  "peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 " +
  "dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700/50 " +
  "dark:peer-checked:border-blue-500 dark:peer-checked:bg-blue-950/40 dark:peer-checked:ring-blue-500";

function CustomerCard({
  customer,
  side,
}: {
  customer: CustomerSummaryView;
  side: "keep" | "merge";
}) {
  return (
    <div
      className={`min-w-0 rounded-lg border p-3 ${
        side === "keep"
          ? "border-green-300 bg-green-50/60 dark:border-green-800 dark:bg-green-950/20"
          : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {side === "keep" ? "Keep" : "Merge in & archive"}
      </p>
      <p className="truncate font-semibold text-gray-900 dark:text-gray-100" title={customer.displayName}>
        {customer.displayName}
      </p>
      <p className="truncate text-sm text-gray-600 dark:text-gray-400">
        {[customer.companyName, customer.email].filter(Boolean).join(" · ") || "No details"}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {`${plural(customer.quoteCount, "Quote")} · ${plural(customer.orderCount, "Order")}`}
      </p>
    </div>
  );
}

/** Side-by-side conflict resolution plus a preview of what the merge will move. */
export function CustomerMergeReview({
  preview,
  onConfirm,
  onCancel,
  onSwap,
  isSubmitting = false,
  error,
}: Props) {
  // The survivor's value is pre-selected, except where an explicit choice is required.
  const [choices, setChoices] = useState<Record<string, MergeFieldChoice>>(() =>
    Object.fromEntries(
      preview.conflicts
        .filter((conflict) => !conflict.requiresExplicitChoice)
        .map((conflict) => [conflict.field, "survivor" as const]),
    ),
  );
  const canConfirm = preview.conflicts.every((conflict) => choices[conflict.field]);

  // Only record the choices that differ from the default so the event log stays readable.
  const submit = () => {
    const explicit = Object.fromEntries(
      Object.entries(choices).filter(
        ([field, choice]) =>
          choice === "merged" ||
          preview.conflicts.find((conflict) => conflict.field === field)
            ?.requiresExplicitChoice,
      ),
    );
    onConfirm(explicit);
  };

  // Customers keep their sides when swapped, so the lower id is always first.
  const [first, second] =
    preview.survivor.id < preview.merged.id
      ? [preview.survivor, preview.merged]
      : [preview.merged, preview.survivor];
  const { counts } = preview;
  const moving = [
    plural(counts.quotes, "Quote"),
    plural(counts.orders, "Order"),
    plural(counts.parts, "Part"),
    plural(counts.attachments, "Attachment") +
      (preview.attachmentsAlreadyLinked > 0
        ? ` (${preview.attachmentsAlreadyLinked} already linked to both)`
        : ""),
    plural(counts.communications, "communication"),
    plural(counts.notes, "Note"),
  ];

  return (
    <div className="space-y-6">
      <div className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <CustomerCard
          customer={first}
          side={first.id === preview.survivor.id ? "keep" : "merge"}
        />
        <MergeDirectionArrow
          pointsToFirst={first.id === preview.survivor.id}
          onClick={onSwap}
          disabled={isSubmitting}
          label="Swap which Customer is kept"
        />
        <CustomerCard
          customer={second}
          side={second.id === preview.survivor.id ? "keep" : "merge"}
        />
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300">
        <strong>{preview.merged.displayName}</strong> will be merged into{" "}
        <strong>{preview.survivor.displayName}</strong> and archived. This cannot be
        undone from the app.
      </p>

      {preview.conflicts.length > 0 && (
        <section aria-labelledby="merge-conflicts-heading">
          <h3
            id="merge-conflicts-heading"
            className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
          >
            Resolve differences
          </h3>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-2 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)]">
            <span aria-hidden="true" />
            <span className="truncate px-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              Keep: {preview.survivor.displayName}
            </span>
            <span className="truncate px-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              Use: {preview.merged.displayName}
            </span>
            {preview.conflicts.map((conflict) => (
              <div key={conflict.field} role="radiogroup" aria-label={conflict.label} className="contents">
                <div className="self-center text-sm font-medium text-gray-700 dark:text-gray-300">
                  {conflict.label}
                  {conflict.requiresExplicitChoice && (
                    <span className="mt-0.5 block text-xs font-normal text-amber-700 dark:text-amber-400">
                      Choose one — billing terms are never changed silently
                    </span>
                  )}
                </div>
                {(
                  [
                    ["survivor", conflict.survivorValue],
                    ["merged", conflict.mergedValue],
                  ] as const
                ).map(([side, value]) => (
                  <label key={side} className="relative block min-w-0 cursor-pointer">
                    <input
                      type="radio"
                      name={`choice-${conflict.field}`}
                      checked={choices[conflict.field] === side}
                      onChange={() =>
                        setChoices((current) => ({ ...current, [conflict.field]: side }))
                      }
                      className="peer sr-only"
                    />
                    <span className={`${CELL_CLASSES} break-words`}>{value}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {preview.autoFills.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Filled in from {preview.merged.displayName}
          </h3>
          <ul className="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300">
            {preview.autoFills.map((fill) => (
              <li key={fill.field}>
                {fill.label}: {fill.value}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          What will move
        </h3>
        <ul aria-label="Records that will move" className="flex flex-wrap gap-2">
          {moving.map((label) => (
            <li
              key={label}
              className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-800 dark:bg-gray-700 dark:text-gray-100"
            >
              {label}
            </li>
          ))}
        </ul>
        {preview.retainedEmails.length > 0 && (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Future RFQs from {preview.retainedEmails.join(", ")} will attach to{" "}
            {preview.survivor.displayName}.
          </p>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 -mb-1 flex justify-end gap-3 border-t border-gray-200 bg-white pt-4 dark:border-gray-700 dark:bg-gray-800">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={!canConfirm || isSubmitting}
          onClick={submit}
        >
          Merge Customers
        </Button>
      </div>
    </div>
  );
}
