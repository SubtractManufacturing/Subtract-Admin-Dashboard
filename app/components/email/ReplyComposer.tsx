import { useState, useEffect, useCallback } from "react";
import { useFetcher } from "@remix-run/react";
import type { Email } from "~/lib/db/schema";
import Button from "~/components/shared/Button";

interface ReplyComposerProps {
  replyToEmail: Email;
  sendAsAddresses: { email: string; label: string }[];
  onSuccess?: () => void;
  onCancel?: () => void;
}

/**
 * Inline reply composer for thread view
 * Pre-fills recipient based on the email being replied to
 * Sends reply with proper threading headers
 */
export function ReplyComposer({
  replyToEmail,
  sendAsAddresses,
  onSuccess,
  onCancel,
}: ReplyComposerProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();

  // Determine the default "From" address
  // If the original was sent TO one of our addresses, use that address
  // Otherwise, use the default
  const getDefaultFromAddress = useCallback((): string => {
    if (replyToEmail.direction === "inbound") {
      // For inbound emails, check if it was sent to one of our addresses
      const toAddress = replyToEmail.toAddresses?.[0]?.toLowerCase();
      const matchingSendAs = sendAsAddresses.find(
        (addr) => addr.email.toLowerCase() === toAddress
      );
      if (matchingSendAs) {
        return matchingSendAs.email;
      }
    } else {
      // For outbound emails we sent, reply from the same address
      const fromAddress = replyToEmail.fromAddress.toLowerCase();
      const matchingSendAs = sendAsAddresses.find(
        (addr) => addr.email.toLowerCase() === fromAddress
      );
      if (matchingSendAs) {
        return matchingSendAs.email;
      }
    }
    // Fallback to first available address
    return sendAsAddresses[0]?.email || "";
  }, [replyToEmail, sendAsAddresses]);

  // Determine the recipient
  const getRecipient = useCallback((): string => {
    if (replyToEmail.direction === "inbound") {
      // Reply to the sender
      return replyToEmail.fromAddress;
    } else {
      // Reply to the original recipient
      return replyToEmail.toAddresses?.[0] || "";
    }
  }, [replyToEmail]);

  const [formData, setFormData] = useState({
    from: getDefaultFromAddress(),
    to: getRecipient(),
    body: "",
  });

  const [isExpanded, setIsExpanded] = useState(false);

  const isSubmitting = fetcher.state === "submitting";
  const isSuccess = fetcher.data?.success;
  const serverError = fetcher.data?.error;

  // Handle success
  useEffect(() => {
    if (isSuccess) {
      setFormData((prev) => ({ ...prev, body: "" }));
      setIsExpanded(false);
      onSuccess?.();
    }
  }, [isSuccess, onSuccess]);

  // Reset form when replyToEmail changes
  useEffect(() => {
    setFormData({
      from: getDefaultFromAddress(),
      to: getRecipient(),
      body: "",
    });
  }, [replyToEmail.id, getDefaultFromAddress, getRecipient]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetcher.submit(
      {
        intent: "sendReply",
        replyToEmailId: replyToEmail.id.toString(),
        from: formData.from,
        body: formData.body,
        to: formData.to,
      },
      { method: "post" }
    );
  };

  // Collapsed state - just a "Reply" button
  if (!isExpanded) {
    return (
      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2 w-full px-4 py-3 text-sm text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
            />
          </svg>
          Click to reply...
        </button>
      </div>
    );
  }

  // Expanded reply form
  return (
    <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Success message */}
        {isSuccess && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-800 dark:text-green-200 text-sm">
            Reply sent successfully!
          </div>
        )}

        {/* Error message */}
        {serverError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 text-sm">
            {serverError}
          </div>
        )}

        {/* From field */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400 w-12">
            From:
          </span>
          {sendAsAddresses.length > 1 ? (
            <select
              id="reply-from"
              aria-label="From address"
              value={formData.from}
              onChange={(e) => setFormData({ ...formData, from: e.target.value })}
              className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              disabled={isSubmitting}
            >
              {sendAsAddresses.map((addr) => (
                <option key={addr.email} value={addr.email}>
                  {addr.label} &lt;{addr.email}&gt;
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {sendAsAddresses[0]?.label || "No sender"} &lt;{formData.from}&gt;
            </span>
          )}
        </div>

        {/* To field */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400 w-12">
            To:
          </span>
          <input
            id="reply-to"
            aria-label="To address"
            type="email"
            value={formData.to}
            onChange={(e) => setFormData({ ...formData, to: e.target.value })}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            disabled={isSubmitting}
          />
        </div>

        {/* Subject (read-only, shows what it will be) */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400 w-12">
            Subject:
          </span>
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {replyToEmail.subject.startsWith("Re:")
              ? replyToEmail.subject
              : `Re: ${replyToEmail.subject}`}
          </span>
        </div>

        {/* Body */}
        <div>
          <textarea
            id="reply-body"
            aria-label="Reply message"
            value={formData.body}
            onChange={(e) => setFormData({ ...formData, body: e.target.value })}
            rows={6}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Write your reply..."
            disabled={isSubmitting}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setIsExpanded(false);
              onCancel?.();
            }}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isSubmitting || !formData.body.trim()}
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Sending...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
                Send Reply
              </span>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default ReplyComposer;
