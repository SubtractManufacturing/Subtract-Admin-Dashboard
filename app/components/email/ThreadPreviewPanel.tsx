import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { Link, useFetcher } from "@remix-run/react";
import { EmailMessage } from "./EmailMessage";
import { ReplyComposer } from "./ReplyComposer";
import { AssignmentDropdown } from "./AssignmentDropdown";
import type { ThreadSummary } from "~/lib/emails";
import type { Email, EmailAttachment } from "~/lib/db/schema";

interface ThreadPreviewPanelProps {
  thread: ThreadSummary;
  emailsWithAttachments: Array<{
    email: Email;
    attachments: EmailAttachment[];
  }>;
  sendAsAddresses: { email: string; label: string }[];
  allUsers?: Array<{ id: string; name: string | null; email: string }>;
  currentUserId?: string;
  onArchive?: (threadId: string) => void;
  onClose?: () => void;
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
  allUsers = [],
  currentUserId,
  onArchive,
  onClose,
}: ThreadPreviewPanelProps) {
  const [replyToEmail, setReplyToEmail] = useState<Email | null>(null);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevEmailCountRef = useRef(emailsWithAttachments.length);
  const archiveFetcher = useFetcher();
  const markUnreadFetcher = useFetcher();

  // Get the last email for default reply
  const lastEmail = emailsWithAttachments[emailsWithAttachments.length - 1]?.email;

  // Scroll to bottom when thread opens (shows most recent email)
  useLayoutEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
    // Reset new message indicator when thread changes
    setHasNewMessage(false);
    prevEmailCountRef.current = emailsWithAttachments.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.threadId]); // Re-scroll when thread changes, intentionally not including emailsWithAttachments.length

  // Detect new messages arriving
  useEffect(() => {
    const currentCount = emailsWithAttachments.length;
    const prevCount = prevEmailCountRef.current;
    
    if (currentCount > prevCount) {
      // New message(s) arrived
      if (isNearBottom) {
        // User is at bottom, auto-scroll to new message
        setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        }, 100);
      } else {
        // User is scrolled up, show indicator
        setHasNewMessage(true);
      }
    }
    
    prevEmailCountRef.current = currentCount;
  }, [emailsWithAttachments.length, isNearBottom]);

  // Track scroll position to know if user is near bottom
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Consider "near bottom" if within 100px of the bottom
      const nearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setIsNearBottom(nearBottom);
      
      // Clear new message indicator if user scrolls to bottom
      if (nearBottom) {
        setHasNewMessage(false);
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Scroll to new message when clicking the indicator
  const scrollToNewMessage = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setHasNewMessage(false);
  }, []);

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

  // Handle mark as unread
  const handleMarkAsUnread = useCallback(() => {
    markUnreadFetcher.submit(
      {
        intent: "markAsUnreadByMe",
        threadId: thread.threadId,
      },
      { method: "post", action: "/emails" }
    );
    // Close the panel after marking as unread
    onClose?.();
  }, [thread.threadId, markUnreadFetcher, onClose]);

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Back/Close Button */}
            {onClose && (
              <button
                onClick={onClose}
                className="flex-shrink-0 p-1.5 -ml-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
                aria-label="Close thread"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white line-clamp-2">
              {thread.subject}
            </h2>
          </div>
          
          {/* Assignment Dropdown */}
          {allUsers.length > 0 && currentUserId && (
            <AssignmentDropdown
              threadId={thread.threadId}
              currentUserId={currentUserId}
              assignedUsers={thread.assignedUsers.map(u => ({
                userId: u.userId,
                userName: u.userName,
                userEmail: u.userEmail,
              }))}
              allUsers={allUsers}
            />
          )}
        </div>

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
          onClick={handleMarkAsUnread}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          }
          label="Mark Unread"
        />
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto scrollbar-hide">
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

      {/* New message indicator */}
      {hasNewMessage && (
        <button
          onClick={scrollToNewMessage}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-full shadow-lg transition-all animate-bounce"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          New message
        </button>
      )}
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
