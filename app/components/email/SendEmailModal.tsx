import { useState, useRef, useEffect, type ReactNode } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import Modal from "~/components/shared/Modal";
import Button from "~/components/shared/Button";

export type SendEmailModalData = {
  success?: boolean;
  error?: string;
};

export type SendEmailAttachmentItem = {
  id: string | number;
  fileName: string;
  fileSize: number | null;
};

type SendEmailModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onQueued?: () => void;
  title: string;
  toEmail: string | null | undefined;
  defaultSubject?: string;
  attachments: SendEmailAttachmentItem[];
  preview: ReactNode;
  /** POST target (e.g. `/email/queue`) */
  action?: string;
  /** Appended as hidden inputs on submit */
  hiddenFields: Record<string, string>;
  /** When modal opens, subject resets from this dependency (e.g. quote number) */
  subjectResetKey?: string;
};

const MAX_EMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export default function SendEmailModal({
  isOpen,
  onClose,
  onQueued,
  title,
  toEmail,
  defaultSubject,
  attachments,
  preview,
  action = "/email/queue",
  hiddenFields,
  subjectResetKey = "",
}: SendEmailModalProps) {
  const fetcher = useFetcher<SendEmailModalData>();
  const revalidator = useRevalidator();
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  const [subject, setSubject] = useState(
    defaultSubject ?? "",
  );

  useEffect(() => {
    if (isOpen) {
      idempotencyKeyRef.current = crypto.randomUUID();
      setSubject(defaultSubject ?? "");
      setError(null);
    }
  }, [isOpen, defaultSubject, subjectResetKey]);

  const [cc, setCc] = useState("");
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

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
        : [...prev, normalizedId],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isOverSizeLimit) return;

    const formData = new FormData();
    formData.append("idempotencyKey", idempotencyKeyRef.current);
    formData.append("subject", subject);
    if (cc) formData.append("cc", cc);
    selectedAttachments.forEach((id) => formData.append("attachmentId", id));
    for (const [k, v] of Object.entries(hiddenFields)) {
      formData.append(k, v);
    }

    fetcher.submit(formData, { method: "post", action });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="2xl">
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
            value={toEmail || ""}
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
                    {a.fileSize
                      ? `${(a.fileSize / 1024 / 1024).toFixed(2)} MB`
                      : "Unknown"}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-2 text-xs flex justify-between">
            <span
              className={
                isOverSizeLimit ? "text-red-500 font-medium" : "text-gray-500"
              }
            >
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
            {preview}
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
