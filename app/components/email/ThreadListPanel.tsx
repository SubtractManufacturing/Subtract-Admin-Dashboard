import { useState, useCallback } from "react";
import { useSearchParams } from "@remix-run/react";
import { ThreadListItem } from "./ThreadListItem";
import type { ThreadSummary } from "~/lib/emails";

interface ThreadListPanelProps {
  threads: ThreadSummary[];
  selectedThreadId?: string | null;
  onThreadSelect?: (threadId: string) => void;
  currentPage: number;
  hasMore: boolean;
  totalThreads?: number;
  isLoading?: boolean;
}

/**
 * ThreadListPanel - Enhanced thread list view with filters and search
 * 
 * Features:
 * - Compact list items with read/unread styling
 * - Filter buttons (All, Unread)
 * - Search input (placeholder for now)
 * - Pagination controls
 * - Empty state handling
 */
export function ThreadListPanel({
  threads,
  selectedThreadId,
  onThreadSelect,
  currentPage,
  hasMore,
  totalThreads,
  isLoading = false,
}: ThreadListPanelProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  
  const statusFilter = searchParams.get("status") || "all";

  const handleFilterChange = useCallback((newStatus: string) => {
    const params = new URLSearchParams(searchParams);
    if (newStatus === "all") {
      params.delete("status");
    } else {
      params.set("status", newStatus);
    }
    params.set("page", "1");
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handlePageChange = useCallback((newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(newPage));
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  return (
    <div className="flex flex-col h-full">
      {/* Header with search and filters */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700">
        {/* Search Bar */}
        <div className="p-3">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search emails..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Filter Buttons */}
        <div className="px-3 pb-3 flex items-center gap-2">
          <button
            onClick={() => handleFilterChange("all")}
            className={`
              px-3 py-1.5 text-sm font-medium rounded-md transition-colors
              ${statusFilter === "all"
                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              }
            `}
          >
            All
          </button>
          <button
            onClick={() => handleFilterChange("unread")}
            className={`
              px-3 py-1.5 text-sm font-medium rounded-md transition-colors
              ${statusFilter === "unread"
                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              }
            `}
          >
            Unread
          </button>
          
          {/* Thread count */}
          {totalThreads !== undefined && (
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
              {totalThreads} {totalThreads === 1 ? "thread" : "threads"}
            </span>
          )}
        </div>
      </div>

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <svg className="animate-spin w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        ) : threads.length === 0 ? (
          <EmptyState statusFilter={statusFilter} />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {threads.map((thread) => (
              <ThreadListItem
                key={thread.threadId}
                thread={thread}
                isSelected={selectedThreadId === thread.threadId}
                onClick={() => onThreadSelect?.(thread.threadId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {threads.length > 0 && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Page {currentPage}
          </span>
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={!hasMore}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Empty state when no threads match the filter
 */
function EmptyState({ statusFilter }: { statusFilter: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-4">
        <svg
          className="w-6 h-6 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
      </div>
      <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
        {statusFilter === "unread" ? "All caught up!" : "No conversations yet"}
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {statusFilter === "unread"
          ? "You've read all your emails."
          : "Incoming emails will appear here."}
      </p>
    </div>
  );
}

export default ThreadListPanel;
