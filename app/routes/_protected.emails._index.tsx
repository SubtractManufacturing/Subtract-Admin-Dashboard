import { useState, useEffect, useCallback } from "react";
import {
  json,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams, useNavigate, useOutletContext } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { 
  getEmailThreads, 
  getThreadCount, 
  getThreadById, 
  getCategoryCounts, 
  getEmailAttachments,
  markThreadAsRead,
  markThreadAsImportant,
  assignThread,
  archiveThread,
} from "~/lib/emails";
import { getActiveSendAsAddresses } from "~/lib/emailSendAsAddresses";
import Button from "~/components/shared/Button";
import Modal from "~/components/shared/Modal";
import { EmailLayout, ThreadListPanel, ThreadPreviewPanel } from "~/components/email";
import type { ThreadSummary } from "~/lib/emails";
import type { Email, EmailAttachment } from "~/lib/db/schema";

export async function loader({ request }: LoaderFunctionArgs) {
  const { headers, user } = await requireAuth(request);

  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const page = parseInt(url.searchParams.get("page") || "1");
  const selectedThreadId = url.searchParams.get("thread");
  const limit = 25;
  const offset = (page - 1) * limit;

  // Determine direction filter based on category
  let direction: "inbound" | "outbound" | undefined;
  if (category === "sent") {
    direction = "outbound";
  }

  // Fetch email threads (grouped by threadId)
  const threads = await getEmailThreads({
    direction,
    limit,
    offset,
  });

  // Get thread count for pagination
  const totalThreads = await getThreadCount({
    direction,
  });

  // Get category counts for sidebar badges
  const categoryCounts = await getCategoryCounts(user?.id);

  // Get send-as addresses for compose
  const sendAsAddresses = await getActiveSendAsAddresses();

  // If a thread is selected, load its details
  let selectedThread: ThreadSummary | null = null;
  let selectedThreadEmails: Array<{ email: Email; attachments: EmailAttachment[] }> = [];
  
  if (selectedThreadId) {
    const threadData = await getThreadById(selectedThreadId);
    if (threadData) {
      selectedThread = threadData.thread;
      // Load attachments for each email
      selectedThreadEmails = await Promise.all(
        threadData.emails.map(async (email) => {
          const attachments = await getEmailAttachments(email.id);
          return { email, attachments };
        })
      );
    }
  }

  return withAuthHeaders(
    json({
      threads,
      sendAsAddresses,
      currentPage: page,
      category,
      totalThreads,
      hasMore: threads.length === limit,
      categoryCounts,
      selectedThread,
      selectedThreadEmails,
      selectedThreadId,
    }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { headers } = await requireAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Send email
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

  // Mark thread as read/unread
  if (intent === "markRead") {
    const threadId = formData.get("threadId") as string;
    const isRead = formData.get("isRead") === "true";

    if (!threadId) {
      return withAuthHeaders(
        json({ error: "threadId is required" }, { status: 400 }),
        headers
      );
    }

    try {
      const thread = await markThreadAsRead(threadId, isRead);
      
      if (!thread) {
        return withAuthHeaders(
          json({ error: "Thread not found" }, { status: 404 }),
          headers
        );
      }

      return withAuthHeaders(
        json({ success: true, thread }),
        headers
      );
    } catch (error) {
      console.error("Failed to mark thread as read:", error);
      return withAuthHeaders(
        json({ error: "Failed to update thread" }, { status: 500 }),
        headers
      );
    }
  }

  // Mark thread as important/starred
  if (intent === "markImportant") {
    const threadId = formData.get("threadId") as string;
    const isImportant = formData.get("isImportant") === "true";

    if (!threadId) {
      return withAuthHeaders(
        json({ error: "threadId is required" }, { status: 400 }),
        headers
      );
    }

    try {
      const thread = await markThreadAsImportant(threadId, isImportant);
      
      if (!thread) {
        return withAuthHeaders(
          json({ error: "Thread not found" }, { status: 404 }),
          headers
        );
      }

      return withAuthHeaders(
        json({ success: true, thread }),
        headers
      );
    } catch (error) {
      console.error("Failed to mark thread as important:", error);
      return withAuthHeaders(
        json({ error: "Failed to update thread" }, { status: 500 }),
        headers
      );
    }
  }

  // Assign thread to a user
  if (intent === "assignThread") {
    const threadId = formData.get("threadId") as string;
    const userId = formData.get("userId") as string | null;

    if (!threadId) {
      return withAuthHeaders(
        json({ error: "threadId is required" }, { status: 400 }),
        headers
      );
    }

    try {
      // If userId is empty string, treat it as null (unassign)
      const effectiveUserId = userId && userId.trim() !== "" ? userId : null;
      
      const thread = await assignThread(threadId, effectiveUserId);
      
      if (!thread) {
        return withAuthHeaders(
          json({ error: "Thread not found" }, { status: 404 }),
          headers
        );
      }

      return withAuthHeaders(
        json({ success: true, thread }),
        headers
      );
    } catch (error) {
      console.error("Failed to assign thread:", error);
      return withAuthHeaders(
        json({ error: "Failed to update thread" }, { status: 500 }),
        headers
      );
    }
  }

  // Archive/unarchive thread
  if (intent === "archiveThread") {
    const threadId = formData.get("threadId") as string;
    const isArchived = formData.get("isArchived") !== "false"; // Default to true

    if (!threadId) {
      return withAuthHeaders(
        json({ error: "threadId is required" }, { status: 400 }),
        headers
      );
    }

    try {
      const thread = await archiveThread(threadId, isArchived);
      
      if (!thread) {
        return withAuthHeaders(
          json({ error: "Thread not found" }, { status: 404 }),
          headers
        );
      }

      return withAuthHeaders(
        json({ success: true, thread }),
        headers
      );
    } catch (error) {
      console.error("Failed to archive thread:", error);
      return withAuthHeaders(
        json({ error: "Failed to update thread" }, { status: 500 }),
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
  const {
    threads,
    sendAsAddresses,
    currentPage,
    category,
    hasMore,
    totalThreads,
    categoryCounts,
    selectedThread,
    selectedThreadEmails,
    selectedThreadId,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isComposeModalOpen, setIsComposeModalOpen] = useState(false);
  const navigate = useNavigate();

  // Check for compose param in URL to auto-open modal
  useEffect(() => {
    const shouldCompose = searchParams.get("compose") === "true";
    if (shouldCompose) {
      setIsComposeModalOpen(true);
      // Remove the compose param from URL
      const params = new URLSearchParams(searchParams);
      params.delete("compose");
      setSearchParams(params, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Handle thread selection
  const handleThreadSelect = useCallback((threadId: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("thread", threadId);
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  // Handle star click (mark important)
  const handleStarClick = useCallback((threadId: string, isImportant: boolean) => {
    // Optimistic update is handled in the component
    // The actual API call would be made via fetcher
  }, []);

  return (
    <EmailLayout
      threadList={
        <ThreadListPanel
          threads={threads}
          selectedThreadId={selectedThreadId}
          onThreadSelect={handleThreadSelect}
          currentPage={currentPage}
          hasMore={hasMore}
          totalThreads={totalThreads}
        />
      }
      threadPreview={
        selectedThread && selectedThreadEmails.length > 0 ? (
          <ThreadPreviewPanel
            thread={selectedThread}
            emailsWithAttachments={selectedThreadEmails}
            sendAsAddresses={sendAsAddresses}
          />
        ) : undefined
      }
      selectedThreadId={selectedThreadId}
      onThreadSelect={handleThreadSelect}
    >
      {/* Compose Modal */}
      <ComposeEmailModal
        isOpen={isComposeModalOpen}
        onClose={() => setIsComposeModalOpen(false)}
        sendAsAddresses={sendAsAddresses}
      />
    </EmailLayout>
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
