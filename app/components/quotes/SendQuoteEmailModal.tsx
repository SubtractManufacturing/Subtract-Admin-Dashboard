import { useState, useRef, useEffect } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import Modal from "~/components/shared/Modal";
import Button from "~/components/shared/Button";
import { QuoteSendEmail as QuoteEmailTemplate } from "~/emails/templates/quote-send";

type QuoteEmailModalData = {
  success?: boolean;
  error?: string;
};

type QuotePreviewData = {
  quoteNumber: string;
  total: string | null;
  stripePaymentLinkUrl: string | null;
};

type CustomerPreviewData = {
  email: string | null;
  displayName: string | null;
};

type EmailAttachmentData = {
  id: string | number;
  fileName: string;
  fileSize: number | null;
};

interface SendQuoteEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onQueued?: () => void;
  quote: QuotePreviewData;
  customer: CustomerPreviewData | null;
  attachments: EmailAttachmentData[];
  /** From configured email template (Admin → Email) */
  defaultSubject?: string;
}

export default function SendQuoteEmailModal({
  isOpen,
  onClose,
  onQueued,
  quote,
  customer,
  attachments,
  defaultSubject,
}: SendQuoteEmailModalProps) {
  const fetcher = useFetcher<QuoteEmailModalData>();
  const revalidator = useRevalidator();
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  const [subject, setSubject] = useState(
    defaultSubject ??
      `Your Quote ${quote.quoteNumber} from Subtract Manufacturing`
  );

  useEffect(() => {
    if (isOpen) {
      setSubject(
        defaultSubject ??
          `Your Quote ${quote.quoteNumber} from Subtract Manufacturing`
      );
    }
  }, [isOpen, defaultSubject, quote.quoteNumber]);
  const [cc, setCc] = useState("");
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const MAX_EMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

  const totalSize = attachments
    .filter((a) => selectedAttachments.includes(String(a.id)))
    .reduce((sum, a) => sum + (a.fileSize || 0), 0);

  const isOverSizeLimit = totalSize > MAX_EMAIL_ATTACHMENT_BYTES;

  useEffect(() => {
    if (fetcher.data?.success) {
      onQueued?.();
      onClose();
      revalidator.revalidate();
    } else if (fetcher.data?.error) {
      setError(fetcher.data.error);
    }
  }, [fetcher.data, onClose, onQueued, revalidator]);

  const handleToggleAttachment = (id: string | number) => {
    const normalizedId = String(id);
    setSelectedAttachments((prev) =>
      prev.includes(normalizedId)
        ? prev.filter((a) => a !== normalizedId)
        : [...prev, normalizedId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isOverSizeLimit) return;
    
    const formData = new FormData();
    formData.append("intent", "queueSendQuoteEmail");
    formData.append("idempotencyKey", idempotencyKeyRef.current);
    formData.append("subject", subject);
    if (cc) formData.append("cc", cc);
    selectedAttachments.forEach((id) => formData.append("attachmentId", id));

    fetcher.submit(formData, { method: "post" });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Send Quote Email" size="2xl">
      <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            To
          </label>
          <input
            type="text"
            readOnly
            value={customer?.email || ""}
            className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            CC (optional)
          </label>
          <input
            type="text"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="comma-separated email addresses"
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Subject
          </label>
          <input
            type="text"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Attachments
          </label>
          {attachments.length === 0 ? (
            <p className="text-sm text-gray-500">No attachments available.</p>
          ) : (
            <div className="flex flex-col gap-2 max-h-40 overflow-y-auto border border-gray-200 rounded-md p-2">
              {attachments.map((a) => (
                <label key={String(a.id)} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedAttachments.includes(String(a.id))}
                    onChange={() => handleToggleAttachment(a.id)}
                    disabled={
                      !selectedAttachments.includes(String(a.id)) &&
                      totalSize + (a.fileSize || 0) > MAX_EMAIL_ATTACHMENT_BYTES
                    }
                  />
                  <span className="truncate flex-1">{a.fileName}</span>
                  <span className="text-gray-500 text-xs">
                    {a.fileSize ? `${(a.fileSize / 1024 / 1024).toFixed(2)} MB` : "Unknown"}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-2 text-xs flex justify-between">
            <span className={isOverSizeLimit ? "text-red-500 font-medium" : "text-gray-500"}>
              Total size: {(totalSize / 1024 / 1024).toFixed(2)} MB / 10 MB
            </span>
            {isOverSizeLimit && (
              <span className="text-red-500">Exceeds Postmark limit</span>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Preview
          </label>
          <div className="border border-gray-300 rounded-md p-4 max-h-64 overflow-y-auto bg-white">
            <QuoteEmailTemplate
              quoteNumber={quote.quoteNumber}
              customerName={customer?.displayName || "Customer"}
              total={quote.total || "0.00"}
              paymentLinkUrl={quote.stripePaymentLinkUrl ?? undefined}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={fetcher.state !== "idle" || isOverSizeLimit}
          >
            {fetcher.state !== "idle" ? "Sending..." : "Send Email"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
