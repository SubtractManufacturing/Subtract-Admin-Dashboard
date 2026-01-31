import { Link } from "@remix-run/react";
import type { ThreadSummary } from "~/lib/emails";

interface ThreadListItemProps {
  thread: ThreadSummary;
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
 * Gmail-style thread list item component
 * Shows thread subject prominently, with participants below
 */
export function ThreadListItem({ thread }: ThreadListItemProps) {
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

  // Format participants for display
  const formatParticipants = () => {
    if (latestDirection === "inbound") {
      // Show who it's from
      const fromName = latestFromName || latestFromAddress.split("@")[0];
      return `From: ${fromName}`;
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

  return (
    <Link
      to={`/emails/thread/${threadId}`}
      className="flex items-start gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors border-b border-gray-200 dark:border-gray-700 last:border-b-0"
    >
      {/* Avatar */}
      <div className="flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-sm font-medium">
          {getInitials(latestFromName, latestFromAddress)}
        </div>
      </div>

      {/* Thread content */}
      <div className="flex-1 min-w-0">
        {/* Subject line - primary, larger */}
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">
              {subject}
            </h3>
            {emailCount > 1 && (
              <span className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                {emailCount}
              </span>
            )}
          </div>

          {/* Timestamp */}
          <span className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">
            {formatRelativeTime(lastEmailAt)}
          </span>
        </div>

        {/* Participants - secondary, smaller */}
        <p className="text-sm text-gray-600 dark:text-gray-400 truncate mt-0.5">
          {formatParticipants()}
        </p>

        {/* Snippet */}
        <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
          {latestSnippet || "(No preview available)"}
        </p>

        {/* Entity badges */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {quoteId && (
            <span className="text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">
              Quote #{quoteId}
            </span>
          )}
          {orderId && (
            <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
              Order #{orderId}
            </span>
          )}
          {customerId && (
            <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
              Customer #{customerId}
            </span>
          )}
          {latestDirection === "inbound" ? (
            <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
              Received
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
              Sent
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default ThreadListItem;
