import { useState, useRef, useEffect, useCallback } from "react";
import { useFetcher } from "@remix-run/react";

interface User {
  id: string;
  name: string | null;
  email: string;
}

interface AssignedUser {
  userId: string;
  userName: string | null;
  userEmail: string;
}

interface AssignmentDropdownProps {
  threadId: string;
  currentUserId: string;
  assignedUsers: AssignedUser[];
  allUsers: User[];
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
 * Get display name from user
 */
function getDisplayName(user: User | AssignedUser): string {
  if ("userName" in user) {
    return user.userName || user.userEmail.split("@")[0];
  }
  return user.name || user.email.split("@")[0];
}

/**
 * AssignmentDropdown - Multi-user assignment selector for email threads
 *
 * Features:
 * - Shows current assignments with avatars and names
 * - Dropdown with checkboxes to assign/unassign users
 * - Search filter for users
 * - Unassign all button
 */
export function AssignmentDropdown({
  threadId,
  currentUserId,
  assignedUsers,
  allUsers,
}: AssignmentDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fetcher = useFetcher();

  const assignedUserIds = new Set(assignedUsers.map((u) => u.userId));

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isOpen]);

  // Filter users by search query
  const filteredUsers = allUsers.filter((user) => {
    const displayName = user.name || user.email;
    return displayName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Handle user toggle
  const handleUserToggle = useCallback(
    (userId: string) => {
      const isCurrentlyAssigned = assignedUserIds.has(userId);

      if (isCurrentlyAssigned) {
        // Unassign user
        fetcher.submit(
          {
            intent: "unassignUser",
            threadId,
            userId,
          },
          { method: "post" }
        );
      } else {
        // Assign user - we need to send the full list
        const newAssignedIds = [...assignedUserIds, userId];
        fetcher.submit(
          {
            intent: "assignUsers",
            threadId,
            userIds: JSON.stringify(newAssignedIds),
          },
          { method: "post" }
        );
      }
    },
    [assignedUserIds, fetcher, threadId]
  );

  // Handle unassign all
  const handleUnassignAll = useCallback(() => {
    fetcher.submit(
      {
        intent: "assignUsers",
        threadId,
        userIds: JSON.stringify([]),
      },
      { method: "post" }
    );
    setIsOpen(false);
  }, [fetcher, threadId]);

  // Handle remove single assignment
  const handleRemoveAssignment = useCallback(
    (userId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      fetcher.submit(
        {
          intent: "unassignUser",
          threadId,
          userId,
        },
        { method: "post" }
      );
    },
    [fetcher, threadId]
  );

  // Format assigned users display
  const getAssignedDisplay = () => {
    if (assignedUsers.length === 0) {
      return "Unassigned";
    }
    if (assignedUsers.length === 1) {
      return getDisplayName(assignedUsers[0]);
    }
    if (assignedUsers.length === 2) {
      return `${getDisplayName(assignedUsers[0])}, ${getDisplayName(assignedUsers[1])}`;
    }
    return `${getDisplayName(assignedUsers[0])}, +${assignedUsers.length - 1} more`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
      >
        {/* Avatars */}
        {assignedUsers.length > 0 && (
          <div className="flex -space-x-1.5">
            {assignedUsers.slice(0, 3).map((user) => (
              <div
                key={user.userId}
                className={`
                  w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium text-white
                  ${user.userId === currentUserId
                    ? "ring-2 ring-orange-500 bg-orange-500"
                    : "bg-blue-500"
                  }
                `}
                title={getDisplayName(user)}
              >
                {getInitials(user.userName, user.userEmail)}
              </div>
            ))}
          </div>
        )}

        <span className="text-gray-700 dark:text-gray-300">
          {assignedUsers.length > 0 ? "Assigned to:" : ""} {getAssignedDisplay()}
        </span>

        {/* Dropdown arrow */}
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          {/* Search Input */}
          <div className="p-2 border-b border-gray-200 dark:border-gray-700">
            <input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
            />
          </div>

          {/* User List */}
          <div className="max-h-60 overflow-y-auto">
            {filteredUsers.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">
                No users found
              </div>
            ) : (
              filteredUsers.map((user) => {
                const isAssigned = assignedUserIds.has(user.id);
                const isMe = user.id === currentUserId;

                return (
                  <button
                    key={user.id}
                    onClick={() => handleUserToggle(user.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    {/* Checkbox */}
                    <div
                      className={`
                        w-4 h-4 rounded border flex items-center justify-center flex-shrink-0
                        ${isAssigned
                          ? "bg-blue-600 border-blue-600"
                          : "border-gray-300 dark:border-gray-600"
                        }
                      `}
                    >
                      {isAssigned && (
                        <svg
                          className="w-3 h-3 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </div>

                    {/* Avatar */}
                    <div
                      className={`
                        w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium text-white flex-shrink-0
                        ${isMe ? "bg-orange-500" : "bg-blue-500"}
                      `}
                    >
                      {getInitials(user.name, user.email)}
                    </div>

                    {/* Name */}
                    <span className="text-sm text-gray-900 dark:text-white flex-1 text-left truncate">
                      {user.name || user.email.split("@")[0]}
                      {isMe && (
                        <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                          (you)
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Currently Assigned Section */}
          {assignedUsers.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 p-2">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 px-1">
                Currently assigned:
              </div>
              <div className="flex flex-wrap gap-1">
                {assignedUsers.map((user) => (
                  <span
                    key={user.userId}
                    className={`
                      inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full
                      ${user.userId === currentUserId
                        ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                      }
                    `}
                  >
                    {getDisplayName(user)}
                    <button
                      onClick={(e) => handleRemoveAssignment(user.userId, e)}
                      className="hover:text-red-500 transition-colors"
                      title="Remove assignment"
                    >
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Unassign All Button */}
          {assignedUsers.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 p-2">
              <button
                onClick={handleUnassignAll}
                className="w-full px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
              >
                Unassign all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AssignmentDropdown;
