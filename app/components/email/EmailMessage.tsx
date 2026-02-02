import { useState } from "react";
import type { Email, EmailAttachment } from "~/lib/db/schema";

interface EmailMessageProps {
  email: Email;
  attachments?: EmailAttachment[];
  isFirst?: boolean;
  isLast?: boolean;
  onReply?: (email: Email) => void;
}

/**
 * Format date for display
 */
function formatDate(date: Date | string | null): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Get initials from name or email for avatar
 */
function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  const emailPart = email.split("@")[0];
  return emailPart.slice(0, 2).toUpperCase();
}

/**
 * Individual email message component for thread view
 * Displays sender info, recipients, body, and attachments
 * Supports collapse/expand functionality
 */
export function EmailMessage({
  email,
  attachments = [],
  isFirst = false,
  isLast = false,
  onReply,
}: EmailMessageProps) {
  // First email expanded by default, others collapsed
  const [isExpanded, setIsExpanded] = useState(isFirst || isLast);

  const {
    fromAddress,
    fromName,
    toAddresses,
    ccAddresses,
    textBody,
    htmlBody,
    sentAt,
    direction,
  } = email;

  const displayName = fromName || fromAddress.split("@")[0];
  const isOutbound = direction === "outbound";

  // Collapsed view
  if (!isExpanded) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsExpanded(true); }}
        className="flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer border-b border-gray-200 dark:border-gray-700 transition-colors"
      >
        {/* Avatar */}
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0 ${
            isOutbound
              ? "bg-gradient-to-br from-green-500 to-green-600"
              : "bg-gradient-to-br from-blue-500 to-blue-600"
          }`}
        >
          {getInitials(fromName, fromAddress)}
        </div>

        {/* Collapsed content */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {displayName}
          </span>
          {isOutbound && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              (You)
            </span>
          )}
          <span className="text-gray-400 dark:text-gray-500">-</span>
          <span className="text-sm text-gray-500 dark:text-gray-400 truncate">
            {textBody?.slice(0, 100) || "(No content)"}
          </span>
        </div>

        {/* Timestamp */}
        <span className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">
          {formatDate(sentAt)}
        </span>
      </div>
    );
  }

  // Expanded view
  return (
    <div className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
      {/* Header */}
      <div className="p-4 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0 ${
              isOutbound
                ? "bg-gradient-to-br from-green-500 to-green-600"
                : "bg-gradient-to-br from-blue-500 to-blue-600"
            }`}
          >
            {getInitials(fromName, fromAddress)}
          </div>

          {/* Sender info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 dark:text-white">
                {displayName}
              </span>
              {isOutbound && (
                <span className="text-xs px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
                  Sent
                </span>
              )}
              {!isOutbound && (
                <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                  Received
                </span>
              )}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {fromAddress}
            </div>
          </div>

          {/* Actions and timestamp */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {formatDate(sentAt)}
            </span>
            
            {/* Collapse button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(false);
              }}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
              title="Collapse"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Recipients */}
        <div className="mt-3 text-sm">
          <div className="flex items-start gap-2">
            <span className="text-gray-500 dark:text-gray-400 w-8">To:</span>
            <span className="text-gray-700 dark:text-gray-300">
              {toAddresses?.join(", ") || "(Unknown)"}
            </span>
          </div>
          {ccAddresses && ccAddresses.length > 0 && (
            <div className="flex items-start gap-2 mt-1">
              <span className="text-gray-500 dark:text-gray-400 w-8">Cc:</span>
              <span className="text-gray-700 dark:text-gray-300">
                {ccAddresses.join(", ")}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {htmlBody ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: htmlBody }}
          />
        ) : (
          <pre className="whitespace-pre-wrap text-sm font-sans text-gray-700 dark:text-gray-300">
            {textBody || "(No content)"}
          </pre>
        )}
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="px-4 pb-4">
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Attachments ({attachments.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-2 text-sm px-3 py-2 bg-gray-100 dark:bg-gray-700/50 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                >
                  <svg
                    className="w-4 h-4 text-gray-500 dark:text-gray-400"
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
                  {attachment.contentLength && (
                    <span className="text-gray-400 dark:text-gray-500 text-xs">
                      ({Math.round(attachment.contentLength / 1024)} KB)
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Reply button */}
      {onReply && (
        <div className="px-4 pb-4">
          <button
            onClick={() => onReply(email)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
              />
            </svg>
            Reply
          </button>
        </div>
      )}
    </div>
  );
}

export default EmailMessage;
