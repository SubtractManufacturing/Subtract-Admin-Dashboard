import { Link } from "@remix-run/react";
import { UnreadDot, CategoryBadge } from "./EmailStateIndicators";
import type { ThreadSummary } from "~/lib/emails";

interface ThreadListItemProps {
  thread: ThreadSummary;
  isSelected?: boolean;
  currentUserId?: string;
  onClick?: () => void;
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
 * - Assigned to me + Unread: Orange left border, orange background tint, bold text
 * - Unread (not assigned to me): White background, bold text, blue dot
 * - Read: Grayed background, normal text, no dot
 * - Important: Yellow star icon (filled when starred)
 * - Selected: Blue left border, light blue background
 */
export function ThreadListItem({
  thread,
  isSelected = false,
  currentUserId,
  onClick,
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
    isReadByCurrentUser,
    assignedUserIds,
    assignedUsers,
  } = thread;

  // Derived state
  const isAssignedToMe = currentUserId ? assignedUserIds.includes(currentUserId) : false;
  const isUnreadByMe = !isReadByCurrentUser;
  const needsMyAttention = isAssignedToMe && isUnreadByMe;

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

  // Format assigned users for display
  const formatAssignedUsers = () => {
    if (assignedUsers.length === 0) return null;
    if (assignedUsers.length === 1) {
      return assignedUsers[0].userName || assignedUsers[0].userEmail.split("@")[0];
    }
    if (assignedUsers.length === 2) {
      return `${assignedUsers[0].userName || assignedUsers[0].userEmail.split("@")[0]}, ${assignedUsers[1].userName || assignedUsers[1].userEmail.split("@")[0]}`;
    }
    return `${assignedUsers[0].userName || assignedUsers[0].userEmail.split("@")[0]} +${assignedUsers.length - 1}`;
  };

  // Container classes based on state
  // Orange styling for "assigned to me + unread", Gmail-style for others
  const containerClasses = `
    flex items-start gap-3 px-3 py-3.5 cursor-pointer transition-colors border-l-4
    active:bg-gray-100 dark:active:bg-gray-700
    ${isSelected
      ? "bg-blue-50 dark:bg-blue-900/20 border-l-blue-600"
      : needsMyAttention
        ? "bg-orange-50/50 dark:bg-orange-900/10 border-l-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20"
        : isUnreadByMe
          ? "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-l-transparent"
          : "bg-gray-50/50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700/30 border-l-transparent"
    }
  `;

  // Text classes based on read state and assignment
  const subjectClasses = `
    text-sm truncate
    ${needsMyAttention || isUnreadByMe
      ? "font-semibold text-gray-900 dark:text-white"
      : "font-normal text-gray-700 dark:text-gray-300"
    }
  `;

  const participantClasses = `
    text-xs truncate
    ${needsMyAttention || isUnreadByMe
      ? "font-medium text-gray-700 dark:text-gray-300"
      : "font-normal text-gray-500 dark:text-gray-400"
    }
  `;

  const snippetClasses = `
    text-xs truncate mt-0.5
    ${isUnreadByMe
      ? "text-gray-600 dark:text-gray-400"
      : "text-gray-400 dark:text-gray-500"
    }
  `;

  const Content = (
    <>
      {/* Left side: Indicators + Avatar */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Unread dot - orange for assigned+unread, blue for just unread */}
        <div className="w-2 flex justify-center">
          {needsMyAttention ? (
            <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" aria-label="Needs attention" />
          ) : (
            <UnreadDot isUnread={isUnreadByMe} />
          )}
        </div>

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

        {/* Entity badges and assigned users */}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          {orderId && (
            <CategoryBadge variant="order">Order #{orderId}</CategoryBadge>
          )}
          {quoteId && (
            <CategoryBadge variant="quote">Quote #{quoteId}</CategoryBadge>
          )}
          {customerId && (
            <CategoryBadge variant="customer">Customer #{customerId}</CategoryBadge>
          )}
          
          {/* Assigned users */}
          {assignedUsers.length > 0 && (
            <div className="flex items-center gap-1">
              {/* Avatars */}
              <div className="flex -space-x-1">
                {assignedUsers.slice(0, 2).map((user) => (
                  <div
                    key={user.userId}
                    className={`
                      w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-medium text-white
                      ${user.userId === currentUserId
                        ? "ring-1 ring-orange-500 bg-orange-500"
                        : "bg-gray-400 dark:bg-gray-500"
                      }
                    `}
                    title={user.userName || user.userEmail}
                  >
                    {getInitials(user.userName, user.userEmail)}
                  </div>
                ))}
              </div>
              
              {/* Names */}
              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                {formatAssignedUsers()}
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );

  // If onClick is provided, use a div with click handler
  // Otherwise use a Link for navigation
  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={containerClasses}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      >
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
