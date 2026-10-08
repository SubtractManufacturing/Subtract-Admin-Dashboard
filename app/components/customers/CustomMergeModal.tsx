import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { MergeDirectionArrow } from "~/components/customers/MergeDirectionArrow";
import Button from "~/components/shared/Button";
import Modal from "~/components/shared/Modal";
import { searchCustomers, type CustomerSearchRecord } from "~/lib/customer-search";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  customers: CustomerSearchRecord[];
  onReview: (keepId: number, mergeInId: number) => void;
};

const RESULT_LIMIT = 50;

type PickerProps = {
  label: string;
  side: "keep" | "merge";
  customers: CustomerSearchRecord[];
  selectedId: number | null;
  /** The Customer picked on the other side; it cannot be picked twice. */
  takenId: number | null;
  onSelect: (id: number | null) => void;
  /** Move focus to the search box once the modal has opened. */
  focusOnOpen?: boolean;
};

function CustomerRow({
  customer,
  isSelected,
  disabled,
  onClick,
}: {
  customer: CustomerSearchRecord;
  isSelected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const contact = [customer.companyName, customer.contactName].filter(Boolean).join(" · ");
  const reach = [customer.email, customer.phone].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={isSelected}
      title={isSelected ? "Selected. Click to clear." : undefined}
      onClick={onClick}
      className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        isSelected
          ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600 dark:border-blue-500 dark:bg-blue-950/40 dark:ring-blue-500"
          : "border-transparent bg-white hover:border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:hover:border-gray-600 dark:hover:bg-gray-700/50"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-gray-900 dark:text-gray-100">
          {customer.displayName}
        </span>
        {contact && (
          <span className="block truncate text-gray-600 dark:text-gray-400">{contact}</span>
        )}
        {reach && (
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{reach}</span>
        )}
      </span>
      {isSelected && (
        <X className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
      )}
    </button>
  );
}

function CustomerPicker({
  label,
  side,
  customers,
  selectedId,
  takenId,
  onSelect,
  focusOnOpen,
}: PickerProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // The Modal focuses itself after mounting, so wait a tick to take focus back.
  useEffect(() => {
    if (!focusOnOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [focusOnOpen]);

  const selected = customers.find((customer) => customer.id === selectedId) ?? null;
  // The selected Customer is pinned above the list, so it never needs to match
  // the search and never shows up twice.
  const { results, total } = useMemo(
    () =>
      searchCustomers(
        customers.filter((customer) => customer.id !== selectedId),
        query,
        RESULT_LIMIT,
      ),
    [customers, query, selectedId],
  );

  return (
    <section
      aria-label={label}
      className={`flex min-w-0 flex-col rounded-lg border p-3 transition-colors duration-300 ${
        side === "keep"
          ? "border-green-300 bg-green-50/40 dark:border-green-800 dark:bg-green-950/10"
          : "border-gray-200 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/30"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</h3>
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide transition-colors duration-300 ${
            side === "keep"
              ? "bg-green-600 text-white dark:bg-green-700"
              : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
          }`}
        >
          {side === "keep" ? "Keep" : "Merge in"}
        </span>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, email, phone, company…"
          aria-label={`Search ${label}`}
          ref={inputRef}
          className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      {selected ? (
        <div className="mt-2 border-b border-gray-200 pb-2 dark:border-gray-700">
          <CustomerRow customer={selected} isSelected onClick={() => onSelect(null)} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Choose a Customer below</p>
      )}

      <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
        {results.map((customer) => (
          <li key={customer.id}>
            <CustomerRow
              customer={customer}
              isSelected={false}
              disabled={customer.id === takenId}
              onClick={() => onSelect(customer.id)}
            />
          </li>
        ))}
        {results.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {query.trim() ? `No Customers match “${query.trim()}”.` : "No other Customers."}
          </li>
        )}
      </ul>
      {total > results.length && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {`Showing ${results.length} of ${total}. Keep typing to narrow it down.`}
        </p>
      )}
    </section>
  );
}

/** Pick any two Customers by searching name, email, phone, company or contact. */
export function CustomMergeModal({
  isOpen,
  onClose,
  customers,
  onReview,
}: Props) {
  const [firstId, setFirstId] = useState<number | null>(null);
  const [secondId, setSecondId] = useState<number | null>(null);
  const [keepSecond, setKeepSecond] = useState(false);

  const nameOf = (id: number | null) =>
    customers.find((customer) => customer.id === id)?.displayName ?? null;
  const ready = firstId !== null && secondId !== null && firstId !== secondId;
  const keepId = keepSecond ? secondId : firstId;
  const mergeInId = keepSecond ? firstId : secondId;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Custom merge" size="2xl">
      <div className="space-y-5">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Search for any two Customers. The arrow points at the one you keep; click it to
          reverse. Everything from the other Customer moves over and it is archived.
        </p>

        <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <CustomerPicker
            label="First Customer"
            side={keepSecond ? "merge" : "keep"}
            customers={customers}
            selectedId={firstId}
            takenId={secondId}
            onSelect={setFirstId}
            focusOnOpen
          />
          <div className="md:pt-12">
            <MergeDirectionArrow
              pointsToFirst={!keepSecond}
              onClick={() => setKeepSecond((current) => !current)}
              label="Reverse which Customer is kept"
            />
          </div>
          <CustomerPicker
            label="Second Customer"
            side={keepSecond ? "keep" : "merge"}
            customers={customers}
            selectedId={secondId}
            takenId={firstId}
            onSelect={setSecondId}
          />
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white pt-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="min-w-0 text-sm text-gray-700 dark:text-gray-300">
            {ready ? (
              <>
                Merge <strong>{nameOf(mergeInId)}</strong> into <strong>{nameOf(keepId)}</strong>
              </>
            ) : (
              "Pick a Customer on each side."
            )}
          </p>
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!ready}
              onClick={() => ready && onReview(keepId!, mergeInId!)}
            >
              Review merge
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
