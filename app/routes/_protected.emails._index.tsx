import { useState, useEffect } from "react";
import {
  json,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getEmailThreads, getThreadCount } from "~/lib/emails";
import { getActiveSendAsAddresses } from "~/lib/emailSendAsAddresses";
import Button from "~/components/shared/Button";
import Modal from "~/components/shared/Modal";
import { ThreadListItem } from "~/components/email/ThreadListItem";
import type { ThreadSummary } from "~/lib/emails";

export async function loader({ request }: LoaderFunctionArgs) {
  const { headers } = await requireAuth(request);

  const url = new URL(request.url);
  const direction = url.searchParams.get("direction") as
    | "inbound"
    | "outbound"
    | null;
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = 25;
  const offset = (page - 1) * limit;

  // Fetch email threads (grouped by threadId)
  const threads = await getEmailThreads({
    direction: direction || undefined,
    limit,
    offset,
  });

  // Get thread count for pagination
  const totalThreads = await getThreadCount({
    direction: direction || undefined,
  });

  // Get send-as addresses for compose
  const sendAsAddresses = await getActiveSendAsAddresses();

  return withAuthHeaders(
    json({
      threads,
      sendAsAddresses,
      currentPage: page,
      direction,
      totalThreads,
      hasMore: threads.length === limit,
    }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { headers } = await requireAuth(request);
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

  return withAuthHeaders(
    json({ error: "Invalid intent" }, { status: 400 }),
    headers
  );
}

export default function EmailsPage() {
  const { threads, sendAsAddresses, currentPage, direction, hasMore } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isComposeModalOpen, setIsComposeModalOpen] = useState(false);

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
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            Emails
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Conversations grouped by thread
          </p>
        </div>
        <Button variant="primary" onClick={() => setIsComposeModalOpen(true)}>
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Compose
          </span>
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
          All Threads
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

      {/* Thread List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {threads.length === 0 ? (
          <div className="p-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
              No conversations
            </h3>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {direction === "inbound"
                ? "No emails received yet."
                : direction === "outbound"
                ? "No emails sent yet."
                : "Start a conversation by composing a new email."}
            </p>
            <div className="mt-6">
              <Button variant="primary" onClick={() => setIsComposeModalOpen(true)}>
                Compose Email
              </Button>
            </div>
          </div>
        ) : (
          <div>
            {threads.map((thread: ThreadSummary) => (
              <ThreadListItem key={thread.threadId} thread={thread} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {threads.length > 0 && (
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
            disabled={!hasMore}
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
    <Modal isOpen={isOpen} onClose={onClose} title="Compose Email" size="lg">
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
          <label htmlFor="email-from" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            From
          </label>
          {sendAsAddresses.length > 1 ? (
            <select
              id="email-from"
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
            <div id="email-from" className="px-3 py-2 text-gray-700 dark:text-gray-300">
              {sendAsAddresses[0]?.label || "No sender configured"} &lt;
              {sendAsAddresses[0]?.email || ""}&gt;
            </div>
          )}
        </div>

        {/* To */}
        <div>
          <label htmlFor="email-to" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            To
          </label>
          <input
            id="email-to"
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
          <label htmlFor="email-subject" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Subject
          </label>
          <input
            id="email-subject"
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
          <label htmlFor="email-body" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Message
          </label>
          <textarea
            id="email-body"
            value={formData.body}
            onChange={(e) => setFormData({ ...formData, body: e.target.value })}
            rows={10}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
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
                Send Email
              </span>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
