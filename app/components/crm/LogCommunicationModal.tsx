import { useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import Modal from "~/components/shared/Modal";
import Button from "~/components/shared/Button";
import SearchableSelect from "~/components/shared/SearchableSelect";
import {
  COMMUNICATION_METHODS,
  COMMUNICATION_METHOD_LABELS,
  type CommunicationMethod,
} from "~/lib/crm-constants";

type CustomerOption = {
  id: string;
  displayName: string;
  email?: string | null;
};

type ContactOption = {
  id: string;
  name: string | null;
  email: string | null;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  customers: CustomerOption[];
  defaultCustomerId?: string | null;
  lockCustomer?: boolean;
  /** Contacts of the locked Customer; lets staff say who they spoke to. */
  contacts?: ContactOption[];
};

export default function LogCommunicationModal({
  isOpen,
  onClose,
  customers,
  defaultCustomerId = null,
  lockCustomer = false,
  contacts = [],
}: Props) {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const [customerId, setCustomerId] = useState(
    defaultCustomerId ? String(defaultCustomerId) : "",
  );
  const [method, setMethod] = useState<CommunicationMethod | "">("");
  const [contactId, setContactId] = useState("");
  const [note, setNote] = useState("");
  // Remix keeps fetcher.data after success; only close for a submit in this open session.
  const submittedThisOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    setCustomerId(defaultCustomerId ? String(defaultCustomerId) : "");
    setMethod("");
    setContactId("");
    setNote("");
  }, [isOpen, defaultCustomerId]);

  useEffect(() => {
    if (isOpen) {
      submittedThisOpenRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (
      !isOpen ||
      !submittedThisOpenRef.current ||
      fetcher.state !== "idle" ||
      !fetcher.data?.success
    ) {
      return;
    }
    submittedThisOpenRef.current = false;
    onClose();
  }, [fetcher.data, fetcher.state, isOpen, onClose]);

  const isSubmitting = fetcher.state !== "idle";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Log Communication"
      size="md"
    >
      <fetcher.Form
        method="post"
        action="/crm"
        className="space-y-4"
        onSubmit={() => {
          submittedThisOpenRef.current = true;
        }}
      >
        <input type="hidden" name="intent" value="create" />
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="contactId" value={lockCustomer ? contactId : ""} />

        {lockCustomer ? (
          <div>
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Customer
            </span>
            <p className="text-sm text-gray-900 dark:text-gray-100">
              {customers.find((c) => c.id === defaultCustomerId)?.displayName ??
                "—"}
            </p>
          </div>
        ) : (
          <SearchableSelect
            label="Customer"
            value={customerId}
            onChange={setCustomerId}
            options={customers.map((customer) => ({
              value: customer.id,
              label: customer.displayName,
              secondaryLabel: customer.email || undefined,
            }))}
            placeholder="Search for a customer..."
            required
            emptyMessage="No customers found"
          />
        )}

        {lockCustomer && contacts.length > 1 && (
          <div>
            <label
              htmlFor="crm-contact"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Contact (optional)
            </label>
            <select
              id="crm-contact"
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="">Not recorded</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name || contact.email || "Unnamed contact"}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label
            htmlFor="crm-method"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Method
          </label>
          <select
            id="crm-method"
            name="method"
            required
            value={method}
            onChange={(e) =>
              setMethod(e.target.value as CommunicationMethod | "")
            }
            className="w-full h-10 px-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a method…</option>
            {COMMUNICATION_METHODS.map((m) => (
              <option key={m} value={m}>
                {COMMUNICATION_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="crm-note"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Note
          </label>
          <textarea
            id="crm-note"
            name="note"
            required
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="What was discussed…"
          />
        </div>

        {fetcher.data?.error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {fetcher.data.error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || !customerId}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}
