import { ArrowLeft } from "lucide-react";

type Props = {
  /** True when the merge goes toward the first (left / top) Customer, which is kept. */
  pointsToFirst: boolean;
  /** Reverse the merge. Omit for a plain, non-interactive arrow. */
  onClick?: () => void;
  label?: string;
  disabled?: boolean;
};

/**
 * Points from the Customer being merged in toward the one being kept. Side by
 * side it points left or right; stacked it points up or down. Reversing the
 * merge spins it half a turn.
 */
export function MergeDirectionArrow({ pointsToFirst, onClick, label, disabled }: Props) {
  const arrow = (
    <ArrowLeft
      className={`h-4 w-4 transition-transform duration-300 ease-in-out ${
        pointsToFirst ? "rotate-90 md:rotate-0" : "-rotate-90 md:rotate-180"
      }`}
      aria-hidden="true"
    />
  );

  if (!onClick) {
    return (
      <span className="mx-auto flex h-9 w-9 items-center justify-center text-gray-400 dark:text-gray-500">
        {arrow}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title="Merge direction: click to reverse"
      className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
    >
      {arrow}
    </button>
  );
}
