import { useState } from "react";

export function DeleteActionItemButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm font-medium text-red-700 hover:text-red-900 dark:text-red-400"
      >
        Delete
      </button>
    );
  }

  return (
    <div className="rounded border border-red-300 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950/40">
      <p className="mb-2 text-red-900 dark:text-red-200">
        This removes the Action Item from every user&apos;s active view. Its audit history remains stored.
      </p>
      <div className="flex gap-3">
        <button
          type="submit"
          name="intent"
          value="delete"
          className="font-medium text-red-700 hover:text-red-900 dark:text-red-400"
        >
          Confirm delete
        </button>
        <button type="button" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
      <input type="hidden" name="actionItemId" value={id} />
    </div>
  );
}
