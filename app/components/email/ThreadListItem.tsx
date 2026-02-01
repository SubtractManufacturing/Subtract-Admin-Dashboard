import { Link } from "@remix-run/react";
import { useState, useCallback } from "react";
import { UnreadDot, StarIcon, CategoryBadge } from "./EmailStateIndicators";
import type { ThreadSummary } from "~/lib/emails";

interface ThreadListItemProps {
  thread: ThreadSummary;
  isSelected?: boolean;
  isUnread?: boolean;
  isImportant?: boolean;
  onClick?: () => void;
  onStarClick?: (threadId: string, isImportant: boolean) => void;
}

/**
 * Format relative time for display
 */
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
  // Use first part of email before @
  const emailPart = email.split("@")[0];
  return emailPart.slice(0, 2).toUpperCase();
}

/**
 * Gmail-style thread list item component with read/unread/important indicators
 * Shows thread subject prominently, with participants below
 * 
 * Visual indicators:
 * - Unread: Bold text, blue dot, white background
 * - Read: Normal text, muted colors, no dot
 * - Important: Yellow star icon (filled when starred)
 * - Selected: Blue left border, light blue background
 */
export function ThreadListItem({
  thread,
  isSelected = false,
  isUnread = true, // Default to unread for now until we have the DB field
  isImportant = false,
  onClick,
  onStarClick,
}: ThreadListItemProps) {
  const {
    threadId,
    subject,
    participants,
    lastEmailAt,
    emailCount,
    latestSnippet,
    quoteId,
    orderId,
    customerId,
    latestFromAddress,
    latestFromName,
    latestDirection,
  } = thread;

  const [localIsImportant, setLocalIsImportant] = useState(isImportant);

  // Handle star click
  const handleStarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const newValue = !localIsImportant;
    setLocalIsImportant(newValue);
    onStarClick?.(threadId, newValue);
  }, [localIsImportant, threadId, onStarClick]);

  // Format participants for display
  const formatParticipants = () => {
    if (latestDirection === "inbound") {
      // Show who it's from
      const fromName = latestFromName || latestFromAddress.split("@")[0];
      return fromName;
    } else {
      // Show who it was sent to
      const otherParticipants = participants.filter((p) => p !== latestFromAddress);
      if (otherParticipants.length > 0) {
        const names = otherParticipants.map((p) => p.split("@")[0]);
        return `To: ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}`;
      }
      return `To: ${participants[0]?.split("@")[0] || "Unknown"}`;
    }
  };

  // Container classes based on state
  // Using py-3.5 for better touch targets (minimum 44px height)
  const containerClasses = `
    flex items-start gap-3 px-3 py-3.5 cursor-pointer transition-colors
    active:bg-gray-100 dark:active:bg-gray-700
    ${isSelected
      ? "bg-blue-50 dark:bg-blue-900/20 border-l-3 border-l-blue-600"
      : isUnread
        ? "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50"
        : "bg-gray-50/50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700/30"
    }
  `;

  // Text classes based on read state
  const subjectClasses = `
    text-sm truncate
    ${isUnread
      ? "font-semibold text-gray-900 dark:text-white"
      : "font-normal text-gray-700 dark:text-gray-300"
    }
  `;

  const participantClasses = `
    text-xs truncate
    ${isUnread
      ? "font-medium text-gray-700 dark:text-gray-300"
      : "font-normal text-gray-500 dark:text-gray-400"
    }
  `;

  const snippetClasses = `
    text-xs truncate mt-0.5
    ${isUnread
      ? "text-gray-600 dark:text-gray-400"
      : "text-gray-400 dark:text-gray-500"
    }
  `;

  const Content = (
    <>
      {/* Left side: Indicators + Avatar */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Unread dot */}
        <div className="w-2 flex justify-center">
          <UnreadDot isUnread={isUnread} />
        </div>

        {/* Star icon */}
        <StarIcon
          isStarred={localIsImportant}
          onClick={handleStarClick}
          size="sm"
        />

        {/* Avatar */}
        <div
          className={`
            w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0
            ${latestDirection === "outbound"
              ? "bg-gradient-to-br from-green-500 to-green-600"
              : "bg-gradient-to-br from-blue-500 to-blue-600"
            }
          `}
        >
          {getInitials(latestFromName, latestFromAddress)}
        </div>
      </div>

      {/* Thread content */}
      <div className="flex-1 min-w-0">
        {/* Top row: Participant name + timestamp */}
        <div className="flex justify-between items-center gap-2">
          <p className={participantClasses}>
            {formatParticipants()}
          </p>
          <span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">
            {formatRelativeTime(lastEmailAt)}
          </span>
        </div>

        {/* Subject line */}
        <div className="flex items-center gap-2">
          <h3 className={subjectClasses}>
            {subject}
          </h3>
          {emailCount > 1 && (
            <span className="flex-shrink-0 text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
              {emailCount}
            </span>
          )}
        </div>

        {/* Snippet */}
        <p className={snippetClasses}>
          {latestSnippet || "(No preview available)"}
        </p>

        {/* Entity badges */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {orderId && (
            <CategoryBadge variant="order">Order #{orderId}</CategoryBadge>
          )}
          {quoteId && (
            <CategoryBadge variant="quote">Quote #{quoteId}</CategoryBadge>
          )}
          {customerId && (
            <CategoryBadge variant="customer">Customer #{customerId}</CategoryBadge>
          )}
        </div>
      </div>
    </>
  );

  // If onClick is provided, use a div with click handler
  // Otherwise use a Link for navigation
  if (onClick) {
    return (
      <div className={containerClasses} onClick={onClick}>
        {Content}
      </div>
    );
  }

  return (
    <Link to={`/emails/thread/${threadId}`} className={containerClasses}>
      {Content}
    </Link>
  );
}

export default ThreadListItem;
