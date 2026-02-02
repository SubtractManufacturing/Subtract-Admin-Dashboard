import { useState, useCallback, useEffect } from "react";
import { useSearchParams } from "@remix-run/react";

interface EmailLayoutProps {
  children: React.ReactNode;
  threadList: React.ReactNode;
  threadPreview?: React.ReactNode;
  selectedThreadId?: string | null;
  onThreadSelect?: (threadId: string | null) => void;
}

/**
 * EmailLayout - Container for the email system with split-view layout
 * 
 * Features:
 * - Two-panel layout: Thread List | Thread Preview (sidebar is in main app nav)
 * - Responsive: collapses to single column on mobile (< 1024px)
 * - Keyboard navigation support (Escape to go back)
 * - Touch-friendly (44px minimum tap targets)
 * 
 * Mobile Behavior:
 * - Thread list and preview stack/switch
 * - Back button in header to return to list
 */
export function EmailLayout({
  children,
  threadList,
  threadPreview,
  selectedThreadId,
  onThreadSelect,
}: EmailLayoutProps) {
  const [isMobileView, setIsMobileView] = useState(false);
  const [showPreviewOnMobile, setShowPreviewOnMobile] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle responsive layout
  useEffect(() => {
    const checkMobileView = () => {
      setIsMobileView(window.innerWidth < 1024);
    };

    checkMobileView();
    window.addEventListener("resize", checkMobileView);
    return () => window.removeEventListener("resize", checkMobileView);
  }, []);

  // Show preview panel when thread is selected on mobile
  useEffect(() => {
    if (selectedThreadId && isMobileView) {
      setShowPreviewOnMobile(true);
    } else if (!selectedThreadId) {
      setShowPreviewOnMobile(false);
    }
  }, [selectedThreadId, isMobileView]);

  // Handle back to list on mobile
  const handleBackToList = useCallback(() => {
    setShowPreviewOnMobile(false);
    // Remove thread from URL params
    const params = new URLSearchParams(searchParams);
    params.delete("thread");
    setSearchParams(params);
    onThreadSelect?.(null);
  }, [onThreadSelect, searchParams, setSearchParams]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not in an input/textarea
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      // Escape to close preview on mobile
      if (e.key === "Escape" && isMobileView && showPreviewOnMobile) {
        e.preventDefault();
        handleBackToList();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileView, showPreviewOnMobile, handleBackToList]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:flex-row min-w-0 h-full overflow-hidden">
        {/* Mobile Header - only show when viewing preview */}
        {isMobileView && showPreviewOnMobile && (
          <div className="flex-shrink-0 flex items-center gap-2 px-2 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 min-h-[56px]">
            <button
              onClick={handleBackToList}
              className="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 dark:active:bg-gray-600 transition-colors"
              aria-label="Back to inbox"
            >
              <svg className="w-6 h-6 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="font-semibold text-gray-900 dark:text-white text-lg">
              Conversation
            </h1>
          </div>
        )}

        {/* Thread List Panel - hidden on mobile when viewing preview, scrolls independently */}
        <div
          className={`
            w-full lg:w-[380px] xl:w-[420px] flex-shrink-0
            border-r border-gray-200 dark:border-gray-700
            bg-white dark:bg-gray-800
            h-full overflow-hidden
            ${isMobileView && showPreviewOnMobile ? "hidden" : ""}
          `}
        >
          {threadList}
        </div>

        {/* Thread Preview Panel - full width on mobile when viewing, scrolls independently */}
        <div
          className={`
            flex-1 min-w-0
            bg-white dark:bg-gray-800
            h-full overflow-hidden
            ${isMobileView && !showPreviewOnMobile ? "hidden" : ""}
          `}
        >
          {threadPreview || (
            <EmptyPreviewState />
          )}
        </div>
      </div>

      {/* Hidden children slot for additional modals/overlays */}
      {children}
    </div>
  );
}

/**
 * Empty state when no thread is selected
 */
function EmptyPreviewState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-4">
        <svg
          className="w-8 h-8 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
        Select a conversation
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
        Choose a thread from the list to view the conversation and reply to messages.
      </p>
    </div>
  );
}

export default EmailLayout;
