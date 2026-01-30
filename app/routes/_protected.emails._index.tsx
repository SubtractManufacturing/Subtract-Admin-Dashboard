import { useState, useEffect, useCallback } from "react";
import {
  json,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getEmails, getEmailById, getEmailAttachments } from "~/lib/emails";
import { getActiveSendAsAddresses } from "~/lib/emailSendAsAddresses";
import Button from "~/components/shared/Button";
import Modal from "~/components/shared/Modal";
import type { Email, EmailAttachment } from "~/lib/db/schema";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);

  const url = new URL(request.url);
  const direction = url.searchParams.get("direction") as
    | "inbound"
    | "outbound"
    | null;
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = 25;
  const offset = (page - 1) * limit;

  // Fetch emails
  const emails = await getEmails({
    direction: direction || undefined,
    limit,
    offset,
  });

  // Get send-as addresses for compose
  const sendAsAddresses = await getActiveSendAsAddresses();

  return withAuthHeaders(
    json({
      user,
      userDetails,
      emails,
      sendAsAddresses,
      currentPage: page,
      direction,
    }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sendEmail") {
    const from = formData.get("from") as string;
    const to = formData.get("to") as string;
    const subject = formData.get("subject") as string;
    const body = formData.get("body") as string;

    if (!from || !to || !subject || !body) {
      return withAuthHeaders(
        json({ error: "Missing required fields" }, { status: 400 }),
        headers
      );
    }

    try {
      const { sendEmail } = await import(
        "~/lib/postmark/postmark-client.server"
      );
      const result = await sendEmail({
        from,
        to,
        subject,
        body,
      });

      if (result.success) {
        return withAuthHeaders(json({ success: true }), headers);
      } else {
        return withAuthHeaders(
          json({ error: result.error }, { status: 400 }),
          headers
        );
      }
    } catch (error) {
      console.error("Failed to send email:", error);
      return withAuthHeaders(
        json({ error: "Failed to send email" }, { status: 500 }),
        headers
      );
    }
  }

  if (intent === "getEmailDetail") {
    const emailId = formData.get("emailId") as string;
    if (!emailId) {
      return withAuthHeaders(
        json({ error: "Missing email ID" }, { status: 400 }),
        headers
      );
    }

    const email = await getEmailById(parseInt(emailId));
    if (!email) {
      return withAuthHeaders(
        json({ error: "Email not found" }, { status: 404 }),
        headers
      );
    }

    const attachments = await getEmailAttachments(email.id);

    return withAuthHeaders(
      json({ email, attachments }),
      headers
    );
  }

  return withAuthHeaders(
    json({ error: "Invalid intent" }, { status: 400 }),
    headers
  );
}

// Format relative time
function formatRelativeTime(date: Date | string | null): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Truncate text with ellipsis
function truncate(text: string | null, length: number): string {
  if (!text) return "";
  if (text.length <= length) return text;
  return text.slice(0, length) + "...";
}

export default function EmailsPage() {
  const { emails, sendAsAddresses, currentPage, direction } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<{ email?: Email; attachments?: EmailAttachment[] }>();

  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [selectedAttachments, setSelectedAttachments] = useState<
    EmailAttachment[]
  >([]);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isComposeModalOpen, setIsComposeModalOpen] = useState(false);

  // Handle email selection
  const handleEmailClick = useCallback(
    (email: Email) => {
      setSelectedEmail(email);
      setIsDetailModalOpen(true);

      // Fetch email details
      fetcher.submit(
        { intent: "getEmailDetail", emailId: email.id.toString() },
        { method: "post" }
      );
    },
    [fetcher]
  );

  // Update selected email when fetcher returns
  useEffect(() => {
    if (fetcher.data?.email) {
      setSelectedEmail(fetcher.data.email as unknown as Email);
      setSelectedAttachments((fetcher.data.attachments || []) as unknown as EmailAttachment[]);
    }
  }, [fetcher.data]);

  // Filter change
  const handleFilterChange = (newDirection: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (newDirection) {
      params.set("direction", newDirection);
    } else {
      params.delete("direction");
    }
    params.set("page", "1");
    setSearchParams(params);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          Emails
        </h1>
        <Button variant="primary" onClick={() => setIsComposeModalOpen(true)}>
          Compose
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => handleFilterChange(null)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            !direction
              ? "bg-blue-600 text-white"
              : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          All
        </button>
        <button
          onClick={() => handleFilterChange("inbound")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            direction === "inbound"
              ? "bg-blue-600 text-white"
              : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          Inbox
        </button>
        <button
          onClick={() => handleFilterChange("outbound")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            direction === "outbound"
              ? "bg-blue-600 text-white"
              : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          Sent
        </button>
      </div>

      {/* Email List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {emails.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            No emails found
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {emails.map((email: Email) => (
              <div
                key={email.id}
                onClick={() => handleEmailClick(email)}
                className="flex items-start gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
              >
                {/* Direction indicator */}
                <div className="flex-shrink-0 mt-1">
                  {email.direction === "inbound" ? (
                    <div className="w-2 h-2 rounded-full bg-blue-500" title="Inbound" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-green-500" title="Sent" />
                  )}
                </div>

                {/* Email content */}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      {/* From/To */}
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {email.direction === "inbound"
                          ? email.fromName || email.fromAddress
                          : `To: ${email.toAddresses?.[0] || "Unknown"}`}
                      </p>
                      {/* Subject */}
                      <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                        {email.subject}
                      </p>
                      {/* Preview */}
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {truncate(email.textBody, 100)}
                      </p>
                    </div>

                    {/* Timestamp */}
                    <span className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400 ml-4">
                      {formatRelativeTime(email.sentAt)}
                    </span>
                  </div>

                  {/* Entity badges */}
                  <div className="flex gap-2 mt-1">
                    {email.quoteId && (
                      <span className="text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">
                        Quote #{email.quoteId}
                      </span>
                    )}
                    {email.orderId && (
                      <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                        Order #{email.orderId}
                      </span>
                    )}
                    {email.customerId && (
                      <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
                        Customer #{email.customerId}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {emails.length > 0 && (
        <div className="flex justify-center gap-2 mt-4">
          <Button
            variant="secondary"
            disabled={currentPage <= 1}
            onClick={() => {
              const params = new URLSearchParams(searchParams);
              params.set("page", String(currentPage - 1));
              setSearchParams(params);
            }}
          >
            Previous
          </Button>
          <span className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">
            Page {currentPage}
          </span>
          <Button
            variant="secondary"
            disabled={emails.length < 25}
            onClick={() => {
              const params = new URLSearchParams(searchParams);
              params.set("page", String(currentPage + 1));
              setSearchParams(params);
            }}
          >
            Next
          </Button>
        </div>
      )}

      {/* Email Detail Modal */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title={selectedEmail?.subject || "Email"}
      >
        {selectedEmail && (
          <div className="space-y-4">
            {/* Header info */}
            <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <span className="text-gray-500 dark:text-gray-400">From:</span>
                <span className="text-gray-900 dark:text-white">
                  {selectedEmail.fromName
                    ? `${selectedEmail.fromName} <${selectedEmail.fromAddress}>`
                    : selectedEmail.fromAddress}
                </span>

                <span className="text-gray-500 dark:text-gray-400">To:</span>
                <span className="text-gray-900 dark:text-white">
                  {selectedEmail.toAddresses?.join(", ")}
                </span>

                <span className="text-gray-500 dark:text-gray-400">Date:</span>
                <span className="text-gray-900 dark:text-white">
                  {selectedEmail.sentAt
                    ? new Date(selectedEmail.sentAt).toLocaleString()
                    : "Unknown"}
                </span>
              </div>
            </div>

            {/* Body */}
            <div className="prose dark:prose-invert max-w-none">
              {selectedEmail.htmlBody ? (
                <div
                  dangerouslySetInnerHTML={{ __html: selectedEmail.htmlBody }}
                  className="text-sm"
                />
              ) : (
                <pre className="whitespace-pre-wrap text-sm font-sans">
                  {selectedEmail.textBody}
                </pre>
              )}
            </div>

            {/* Attachments */}
            {selectedAttachments.length > 0 && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                  Attachments ({selectedAttachments.length})
                </h4>
                <div className="space-y-2">
                  {selectedAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center gap-2 text-sm p-2 bg-gray-50 dark:bg-gray-700/50 rounded"
                    >
                      <svg
                        className="w-4 h-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                        />
                      </svg>
                      <span className="text-gray-700 dark:text-gray-300">
                        {attachment.filename}
                      </span>
                      <span className="text-gray-400 text-xs">
                        ({Math.round((attachment.contentLength || 0) / 1024)} KB)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Compose Modal */}
      <ComposeEmailModal
        isOpen={isComposeModalOpen}
        onClose={() => setIsComposeModalOpen(false)}
        sendAsAddresses={sendAsAddresses}
      />
    </div>
  );
}

// Compose Email Modal Component
function ComposeEmailModal({
  isOpen,
  onClose,
  sendAsAddresses,
}: {
  isOpen: boolean;
  onClose: () => void;
  sendAsAddresses: { email: string; label: string }[];
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [formData, setFormData] = useState({
    from: "",
    to: "",
    subject: "",
    body: "",
  });

  const isSubmitting = fetcher.state === "submitting";
  const isSuccess = fetcher.data?.success;
  const serverError = fetcher.data?.error;

  // Initialize form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({
        from: sendAsAddresses[0]?.email || "",
        to: "",
        subject: "",
        body: "",
      });
    }
  }, [isOpen, sendAsAddresses]);

  // Close modal on success
  useEffect(() => {
    if (isSuccess) {
      const timer = setTimeout(() => {
        onClose();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetcher.submit(
      {
        intent: "sendEmail",
        ...formData,
      },
      { method: "post" }
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Compose Email">
      <form onSubmit={handleSubmit} className="space-y-4">
        {isSuccess && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-800 dark:text-green-200 text-sm">
            Email sent successfully!
          </div>
        )}

        {serverError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 text-sm">
            {serverError}
          </div>
        )}

        {/* From */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            From
          </label>
          {sendAsAddresses.length > 1 ? (
            <select
              value={formData.from}
              onChange={(e) =>
                setFormData({ ...formData, from: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              disabled={isSubmitting}
            >
              {sendAsAddresses.map((addr) => (
                <option key={addr.email} value={addr.email}>
                  {addr.label} &lt;{addr.email}&gt;
                </option>
              ))}
            </select>
          ) : (
            <div className="px-3 py-2 text-gray-700 dark:text-gray-300">
              {sendAsAddresses[0]?.label || "No sender configured"} &lt;
              {sendAsAddresses[0]?.email || ""}&gt;
            </div>
          )}
        </div>

        {/* To */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            To
          </label>
          <input
            type="email"
            value={formData.to}
            onChange={(e) => setFormData({ ...formData, to: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="recipient@example.com"
            required
            disabled={isSubmitting}
          />
        </div>

        {/* Subject */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Subject
          </label>
          <input
            type="text"
            value={formData.subject}
            onChange={(e) =>
              setFormData({ ...formData, subject: e.target.value })
            }
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="Email subject"
            required
            disabled={isSubmitting}
          />
        </div>

        {/* Body */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Message
          </label>
          <textarea
            value={formData.body}
            onChange={(e) => setFormData({ ...formData, body: e.target.value })}
            rows={8}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="Type your message here..."
            required
            disabled={isSubmitting}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Sending..." : "Send Email"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
