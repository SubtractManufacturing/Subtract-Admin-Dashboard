import { useState } from "react";

import Button from "~/components/shared/Button";
import type {
  MergeFieldChoice,
  MergePreviewView,
} from "~/lib/customer-merge-view";

type Props = {
  preview: MergePreviewView;
  onConfirm: (choices: Record<string, MergeFieldChoice>) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  error?: string | null;
};

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

/** Side-by-side conflict resolution plus a preview of what the merge will move. */
export function CustomerMergeReview({
  preview,
  onConfirm,
  onCancel,
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

  const { counts } = preview;

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-700 dark:text-gray-300">
        <strong>{preview.merged.displayName}</strong> will be merged into{" "}
        <strong>{preview.survivor.displayName}</strong> and archived. This cannot be
        undone from the app.
      </p>

      {preview.conflicts.length > 0 && (
        <section aria-labelledby="merge-conflicts-heading">
          <h3 id="merge-conflicts-heading" className="mb-2 font-semibold text-gray-900 dark:text-gray-100">
            Resolve differences
          </h3>
          <div className="space-y-3">
            {preview.conflicts.map((conflict) => (
              <fieldset
                key={conflict.field}
                className="rounded-md border border-gray-300 p-3 dark:border-gray-600"
              >
                <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                  {conflict.label}
                  {conflict.requiresExplicitChoice && (
                    <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                      Choose one — billing terms are never changed silently
                    </span>
                  )}
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["survivor", preview.survivor.displayName, conflict.survivorValue],
                      ["merged", preview.merged.displayName, conflict.mergedValue],
                    ] as const
                  ).map(([side, owner, value]) => (
                    <label
                      key={side}
                      className="flex cursor-pointer items-start gap-2 rounded border border-gray-200 p-2 text-sm dark:border-gray-700"
                    >
                      <input
                        type="radio"
                        name={`choice-${conflict.field}`}
                        checked={choices[conflict.field] === side}
                        onChange={() =>
                          setChoices((current) => ({ ...current, [conflict.field]: side }))
                        }
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400">
                          {owner}
                        </span>
                        <span className="text-gray-900 dark:text-gray-100">{value}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </section>
      )}

      {preview.autoFills.length > 0 && (
        <section>
          <h3 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">
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
        <h3 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">
          What will move
        </h3>
        <ul
          aria-label="Records that will move"
          className="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300"
        >
          <li>{plural(counts.quotes, "Quote")}</li>
          <li>{plural(counts.orders, "Order")}</li>
          <li>{plural(counts.parts, "Part")}</li>
          <li>
            {plural(counts.attachments, "Attachment")}
            {preview.attachmentsAlreadyLinked > 0 &&
              ` (${preview.attachmentsAlreadyLinked} already linked to both)`}
          </li>
          <li>{plural(counts.communications, "communication")}</li>
          <li>{plural(counts.notes, "Note")}</li>
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

      <div className="flex justify-end gap-3">
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
