import { useEffect, useState } from "react";
import type { FetcherWithComponents } from "@remix-run/react";
import Button from "~/components/shared/Button";
import Modal from "~/components/shared/Modal";
import { CUSTOMER_PO_FILE_ACCEPT } from "~/lib/customer-po";

export type ReceivePoActionData = {
  error?: string;
  validationErrors?: string[];
};

interface ReceivePoModalProps {
  isOpen: boolean;
  onClose: () => void;
  fetcher: FetcherWithComponents<ReceivePoActionData>;
}

export default function ReceivePoModal({
  isOpen,
  onClose,
  fetcher,
}: ReceivePoModalProps) {
  const [poNumber, setPoNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (!isOpen) {
      setPoNumber("");
      setFile(null);
      setClientError(null);
    }
  }, [isOpen]);

  const serverError =
    fetcher.data?.error ||
    (fetcher.data?.validationErrors?.length
      ? fetcher.data.validationErrors.join(" ")
      : null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setClientError(null);

    const trimmed = poNumber.trim();
    if (!trimmed) {
      setClientError("PO number is required.");
      return;
    }
    if (!file) {
      setClientError("Customer PO file is required.");
      return;
    }

    const formData = new FormData();
    formData.append("intent", "receivePo");
    formData.append("poNumber", trimmed);
    formData.append("file", file);
    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Receive PO" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Upload the customer&apos;s purchase order and enter the PO number.
          This will accept the quote and create an order.
        </p>

        <div>
          <label
            htmlFor="receive-po-number"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            PO Number
          </label>
          <input
            id="receive-po-number"
            type="text"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="Customer PO number"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label
            htmlFor="receive-po-file"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Customer PO file
          </label>
          <input
            id="receive-po-file"
            type="file"
            accept={CUSTOMER_PO_FILE_ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/40 dark:file:text-blue-300"
            disabled={isSubmitting}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            PDF or image (PNG, JPG, WebP). Max 10MB.
          </p>
          {file ? (
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              Selected: {file.name}
            </p>
          ) : null}
        </div>

        {(clientError || serverError) && (
          <div className="rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {clientError || serverError}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Receiving…" : "Receive PO & Create Order"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
