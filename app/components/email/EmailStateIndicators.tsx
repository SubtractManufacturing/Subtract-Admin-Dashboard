/**
 * EmailStateIndicators - Reusable indicator components for email states
 * 
 * Components:
 * - UnreadDot: Blue dot indicator for unread threads
 * - StarIcon: Clickable star for important/subscribed threads
 * - CategoryBadge: Colored badges for Orders, Quotes, Customers
 * - AssignmentBadge: Shows assigned user initials
 */

interface UnreadDotProps {
  isUnread: boolean;
  className?: string;
}

/**
 * Blue dot indicator for unread threads
 */
export function UnreadDot({ isUnread, className = "" }: UnreadDotProps) {
  if (!isUnread) return null;
  
  return (
    <span
      className={`w-2 h-2 rounded-full bg-blue-600 flex-shrink-0 ${className}`}
      aria-label="Unread"
    />
  );
}

interface StarIconProps {
  isStarred: boolean;
  onClick?: (e: React.MouseEvent) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Clickable star icon for important/subscribed threads
 * Yellow when starred, gray outline when not
 */
export function StarIcon({
  isStarred,
  onClick,
  size = "md",
  className = "",
}: StarIconProps) {
  const sizeClasses = {
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick?.(e);
      }}
      className={`
        flex-shrink-0 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded
        ${onClick ? "cursor-pointer hover:scale-110" : "cursor-default"}
        ${className}
      `}
      aria-label={isStarred ? "Remove star" : "Add star"}
      type="button"
    >
      {isStarred ? (
        <svg
          className={`${sizeClasses[size]} text-yellow-500`}
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      ) : (
        <svg
          className={`${sizeClasses[size]} text-gray-300 dark:text-gray-600 hover:text-yellow-400 dark:hover:text-yellow-500`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
          />
        </svg>
      )}
    </button>
  );
}

type BadgeVariant = "order" | "quote" | "customer" | "vendor" | "received" | "sent" | "default";

interface CategoryBadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  href?: string;
  className?: string;
}

const badgeColors: Record<BadgeVariant, string> = {
  order: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  quote: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
  customer: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
  vendor: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300",
  received: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400",
  sent: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400",
  default: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400",
};

/**
 * Colored badge for categorizing threads
 * Can be a link if href is provided
 */
export function CategoryBadge({
  variant,
  children,
  href,
  className = "",
}: CategoryBadgeProps) {
  const baseClasses = `
    inline-flex items-center px-2 py-0.5 text-xs font-medium rounded
    ${badgeColors[variant]}
    ${className}
  `;

  if (href) {
    return (
      <a
        href={href}
        className={`${baseClasses} hover:opacity-80 transition-opacity`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </a>
    );
  }

  return <span className={baseClasses}>{children}</span>;
}

interface AssignmentBadgeProps {
  userName?: string;
  userInitials?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Shows assigned user initials in a circular badge
 */
export function AssignmentBadge({
  userName,
  userInitials,
  size = "sm",
  className = "",
}: AssignmentBadgeProps) {
  const initials = userInitials || userName?.slice(0, 2).toUpperCase() || "??";
  
  const sizeClasses = {
    sm: "w-5 h-5 text-[10px]",
    md: "w-6 h-6 text-xs",
  };

  return (
    <span
      className={`
        inline-flex items-center justify-center rounded-full
        bg-blue-600 text-white font-medium
        ${sizeClasses[size]}
        ${className}
      `}
      title={userName ? `Assigned to ${userName}` : `Assigned to user`}
    >
      {initials}
    </span>
  );
}

/**
 * Container for multiple badges with proper spacing
 */
export function BadgeGroup({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {children}
    </div>
  );
}

// Export all components together
export const EmailStateIndicators = {
  UnreadDot,
  StarIcon,
  CategoryBadge,
  AssignmentBadge,
  BadgeGroup,
};

export default EmailStateIndicators;
