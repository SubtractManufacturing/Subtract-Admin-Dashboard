import { useState, useCallback, useRef, useEffect } from "react";
import { Link, useFetcher } from "@remix-run/react";
import { EmailMessage } from "./EmailMessage";
import { ReplyComposer } from "./ReplyComposer";
import type { ThreadSummary } from "~/lib/emails";
import type { Email, EmailAttachment } from "~/lib/db/schema";

interface ThreadPreviewPanelProps {
  thread: ThreadSummary;
  emailsWithAttachments: Array<{
    email: Email;
    attachments: EmailAttachment[];
  }>;
  sendAsAddresses: { email: string; label: string }[];
  isImportant?: boolean;
  assignedToUserId?: string | null;
  onMarkImportant?: (threadId: string, isImportant: boolean) => void;
  onArchive?: (threadId: string) => void;
  onAssign?: (threadId: string, userId: string | null) => void;
}

/**
 * ThreadPreviewPanel - Full conversation view with actions
 * 
 * Features:
 * - Full conversation view with all messages
 * - Action toolbar (reply, forward, archive, important, assign)
 * - Contextual information (linked order/quote)
 * - Assignment dropdown
 * - Important/subscribe toggle
 */
export function ThreadPreviewPanel({
  thread,
  emailsWithAttachments,
  sendAsAddresses,
  isImportant = false,
  assignedToUserId,
  onMarkImportant,
  onArchive,
  onAssign,
}: ThreadPreviewPanelProps) {
  const [replyToEmail, setReplyToEmail] = useState<Email | null>(null);
  const [localIsImportant, setLocalIsImportant] = useState(isImportant);
  const bottomRef = useRef<HTMLDivElement>(null);
  const markImportantFetcher = useFetcher();
  const archiveFetcher = useFetcher();

  // Get the last email for default reply
  const lastEmail = emailsWithAttachments[emailsWithAttachments.length - 1]?.email;

  // Handle reply to specific email
  const handleReply = useCallback((email: Email) => {
    setReplyToEmail(email);
    setTimeout(() => {
      document.getElementById("reply-composer")?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }, 100);
  }, []);

  // Handle reply success
  const handleReplySuccess = useCallback(() => {
    setReplyToEmail(null);
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 500);
  }, []);

  // Toggle important status
  const handleToggleImportant = useCallback(() => {
    const newValue = !localIsImportant;
    setLocalIsImportant(newValue);
    onMarkImportant?.(thread.threadId, newValue);
    
    // Submit to the emails route action
    markImportantFetcher.submit(
      {
        intent: "markImportant",
        threadId: thread.threadId,
        isImportant: String(newValue),
      },
      { method: "post", action: "/emails" }
    );
  }, [localIsImportant, thread.threadId, onMarkImportant, markImportantFetcher]);

  // Handle archive
  const handleArchive = useCallback(() => {
    onArchive?.(thread.threadId);
    // Submit to the emails route action
    archiveFetcher.submit(
      {
        intent: "archiveThread",
        threadId: thread.threadId,
      },
      { method: "post", action: "/emails" }
    );
  }, [thread.threadId, onArchive, archiveFetcher]);

  // Sync local state with prop
  useEffect(() => {
    setLocalIsImportant(isImportant);
  }, [isImportant]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 line-clamp-2">
          {thread.subject}
        </h2>

        {/* Thread metadata */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-gray-500 dark:text-gray-400">
            {thread.emailCount} {thread.emailCount === 1 ? "message" : "messages"}
          </span>

          {/* Entity badges */}
          {thread.orderId && (
            <Link
              to={`/orders/${thread.orderId}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
            >
              Order #{thread.orderId}
            </Link>
          )}
          {thread.quoteId && (
            <Link
              to={`/quotes/${thread.quoteId}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
            >
              Quote #{thread.quoteId}
            </Link>
          )}
          {thread.customerId && (
            <Link
              to={`/customers/${thread.customerId}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
            >
              Customer #{thread.customerId}
            </Link>
          )}

          {/* Participants */}
          <span className="text-gray-500 dark:text-gray-400">
            {thread.participants.slice(0, 2).join(", ")}
            {thread.participants.length > 2 && ` +${thread.participants.length - 2}`}
          </span>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2 overflow-x-auto">
        <ActionButton
          onClick={() => handleReply(lastEmail)}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          }
          label="Reply"
          primary
        />
        <ActionButton
          onClick={() => {/* TODO: Forward */}}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          }
          label="Forward"
        />
        <ActionButton
          onClick={handleArchive}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          }
          label="Archive"
        />
        <ActionButton
          onClick={handleToggleImportant}
          icon={
            localIsImportant ? (
              <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            )
          }
          label={localIsImportant ? "Starred" : "Star"}
          active={localIsImportant}
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {emailsWithAttachments.map(({ email, attachments }, index) => (
            <EmailMessage
              key={email.id}
              email={email}
              attachments={attachments}
              isFirst={index === 0}
              isLast={index === emailsWithAttachments.length - 1}
              onReply={handleReply}
            />
          ))}
        </div>

        {/* Reply Composer */}
        {lastEmail && (
          <div id="reply-composer">
            <ReplyComposer
              replyToEmail={replyToEmail || lastEmail}
              sendAsAddresses={sendAsAddresses}
              onSuccess={handleReplySuccess}
              onCancel={() => setReplyToEmail(null)}
            />
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/**
 * Action button component for the toolbar
 */
function ActionButton({
  onClick,
  icon,
  label,
  primary = false,
  active = false,
}: {
  onClick?: () => void;
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors
        ${primary
          ? "bg-blue-600 text-white hover:bg-blue-700"
          : active
            ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/50"
            : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white"
        }
      `}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export default ThreadPreviewPanel;
