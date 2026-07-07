import { useEffect, useMemo, useState } from "react";
import type { FetcherWithComponents } from "@remix-run/react";
import Button from "~/components/shared/Button";
import Modal from "~/components/shared/Modal";

export type OrderTrackingActionData = {
  error?: string;
  success?: boolean;
};

type TrackingNumber = {
  id: number;
  trackingNumber: string;
  createdAt?: string | Date;
};

type Row = {
  localId: string;
  existingId: number | null;
  original: string;
  value: string;
  createdAt?: string | Date;
  deleted: boolean;
};

type OrderTrackingModalProps = {
  isOpen: boolean;
  onClose: () => void;
  mode: "advance" | "manage";
  existingTrackingNumbers: TrackingNumber[];
  fetcher: FetcherWithComponents<OrderTrackingActionData>;
  disabled?: boolean;
};

let localIdCounter = 0;
function nextLocalId() {
  localIdCounter += 1;
  return `local-${localIdCounter}`;
}

function buildInitialRows(existing: TrackingNumber[]): Row[] {
  return existing.map((tracking) => ({
    localId: nextLocalId(),
    existingId: tracking.id,
    original: tracking.trackingNumber,
    value: tracking.trackingNumber,
    createdAt: tracking.createdAt,
    deleted: false,
  }));
}

export default function OrderTrackingModal({
  isOpen,
  onClose,
  mode,
  existingTrackingNumbers,
  fetcher,
  disabled = false,
}: OrderTrackingModalProps) {
  const [rows, setRows] = useState<Row[]>(() =>
    buildInitialRows(existingTrackingNumbers),
  );
  const [showOverrideConfirm, setShowOverrideConfirm] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (!isOpen) return;
    setRows(buildInitialRows(existingTrackingNumbers));
    setShowOverrideConfirm(false);
    setHasSubmitted(false);
  }, [isOpen, existingTrackingNumbers]);

  useEffect(() => {
    if (
      isOpen &&
      hasSubmitted &&
      fetcher.state === "idle" &&
      fetcher.data?.success
    ) {
      onClose();
    }
  }, [fetcher.data, fetcher.state, hasSubmitted, isOpen, onClose]);

  const activeRows = useMemo(() => rows.filter((row) => !row.deleted), [rows]);

  const staged = useMemo(() => {
    const newTrackingNumbers: string[] = [];
    const updatedTrackingNumbers: { id: number; trackingNumber: string }[] = [];
    const deletedIds: number[] = [];

    for (const row of rows) {
      const trimmed = row.value.trim();
      if (row.existingId === null) {
        if (row.deleted) continue;
        if (trimmed) newTrackingNumbers.push(trimmed);
        continue;
      }
      if (row.deleted) {
        deletedIds.push(row.existingId);
        continue;
      }
      if (trimmed && trimmed !== row.original) {
        updatedTrackingNumbers.push({
          id: row.existingId,
          trackingNumber: trimmed,
        });
      }
    }

    return { newTrackingNumbers, updatedTrackingNumbers, deletedIds };
  }, [rows]);

  const hasChanges =
    staged.newTrackingNumbers.length > 0 ||
    staged.updatedTrackingNumbers.length > 0 ||
    staged.deletedIds.length > 0;
  const hasTrackingAfterSave = activeRows.some((row) => row.value.trim());
  const canSubmitManage = hasChanges && !disabled && !isSubmitting;
  const canSubmitAdvance = hasTrackingAfterSave && !disabled && !isSubmitting;

  const addRow = () => {
    setRows((current) => [
      ...current,
      {
        localId: nextLocalId(),
        existingId: null,
        original: "",
        value: "",
        deleted: false,
      },
    ]);
  };

  const updateRowValue = (localId: string, value: string) => {
    setRows((current) =>
      current.map((row) => (row.localId === localId ? { ...row, value } : row)),
    );
  };

  const removeRow = (localId: string) => {
    setRows((current) => {
      const row = current.find((r) => r.localId === localId);
      if (!row) return current;
      if (row.existingId === null) {
        return current.filter((r) => r.localId !== localId);
      }
      return current.map((r) =>
        r.localId === localId ? { ...r, deleted: true } : r,
      );
    });
  };

  const undoRemove = (localId: string) => {
    setRows((current) =>
      current.map((row) =>
        row.localId === localId ? { ...row, deleted: false } : row,
      ),
    );
  };

  const submit = (skipTrackingOverride = false) => {
    const formData = new FormData();
    formData.append(
      "intent",
      mode === "advance" ? "shipOrder" : "manageTrackingNumbers",
    );
    formData.append(
      "newTrackingNumbers",
      JSON.stringify(staged.newTrackingNumbers),
    );
    formData.append(
      "updatedTrackingNumbers",
      JSON.stringify(staged.updatedTrackingNumbers),
    );
    formData.append("deletedIds", JSON.stringify(staged.deletedIds));
    if (skipTrackingOverride) {
      formData.append("skipTrackingOverride", "true");
    }

    setHasSubmitted(true);
    fetcher.submit(formData, { method: "post" });
    setShowOverrideConfirm(false);
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={mode === "advance" ? "Ship Order" : "Tracking Numbers"}
        size="lg"
      >
        <div className="space-y-5">
          {mode === "advance" && (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Add at least one tracking number to move this order to Shipped.
            </p>
          )}

          {disabled && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
              Archived orders cannot be updated.
            </div>
          )}

          {hasSubmitted && fetcher.data?.error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              {fetcher.data.error}
            </div>
          )}

          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No tracking numbers yet.
              </p>
              <button
                type="button"
                onClick={addRow}
                disabled={disabled || isSubmitting}
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400 dark:hover:text-blue-300"
              >
                <PlusIcon />
                Add tracking number
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => (
                <li key={row.localId} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.value}
                    onChange={(event) =>
                      updateRowValue(row.localId, event.target.value)
                    }
                    disabled={row.deleted || disabled || isSubmitting}
                    placeholder="Enter tracking number"
                    className={`min-w-0 flex-1 rounded-md border px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed dark:bg-gray-700 dark:text-gray-100 ${
                      row.deleted
                        ? "border-red-200 bg-red-50 text-red-700 line-through dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                        : "border-gray-300 bg-white text-gray-900 dark:border-gray-600"
                    }`}
                  />
                  {row.deleted ? (
                    <button
                      type="button"
                      onClick={() => undoRemove(row.localId)}
                      disabled={disabled || isSubmitting}
                      className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      Undo
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeRow(row.localId)}
                      disabled={disabled || isSubmitting}
                      aria-label="Remove tracking number"
                      title="Remove tracking number"
                      className="rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-500 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {rows.length > 0 && (
            <div>
              <button
                type="button"
                onClick={addRow}
                disabled={disabled || isSubmitting}
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400 dark:hover:text-blue-300"
              >
                <PlusIcon />
                Add tracking number
              </button>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between">
            {mode === "advance" ? (
              <button
                type="button"
                onClick={() => setShowOverrideConfirm(true)}
                disabled={disabled || isSubmitting}
                className="text-xs font-medium text-amber-700 underline underline-offset-2 hover:text-amber-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-400 dark:hover:text-amber-300"
              >
                Ship without tracking
              </button>
            ) : (
              <span />
            )}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => submit(false)}
                disabled={mode === "advance" ? !canSubmitAdvance : !canSubmitManage}
                className={
                  mode === "advance" ? "bg-teal-600 hover:bg-teal-700" : ""
                }
              >
                {isSubmitting
                  ? "Saving..."
                  : mode === "advance"
                    ? "Ship Order"
                    : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showOverrideConfirm}
        onClose={() => setShowOverrideConfirm(false)}
        title="Ship without tracking?"
        zIndex={60}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            This order will move to Shipped without any tracking numbers. Only
            use this when tracking is unavailable or will be added later.
          </p>
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowOverrideConfirm(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => submit(true)}
              disabled={disabled || isSubmitting}
            >
              {isSubmitting ? "Shipping..." : "Okay, ship anyway"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function PlusIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4v16m8-8H4"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}
