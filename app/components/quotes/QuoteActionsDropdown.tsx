import { useEffect, useRef } from "react";

interface QuoteActionsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  excludeRef?: React.RefObject<HTMLElement>;
  quoteStatus: string;
  onReviseQuote: () => void;
  onCalculatePricing?: () => void;
  onDownloadFiles?: () => void;
  isDownloading?: boolean;
}

export default function QuoteActionsDropdown({
  isOpen,
  onClose,
  excludeRef,
  quoteStatus,
  onReviseQuote,
  onCalculatePricing,
  onDownloadFiles,
  isDownloading = false,
}: QuoteActionsDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        (!excludeRef?.current ||
          !excludeRef.current.contains(event.target as Node))
      ) {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isOpen, onClose, excludeRef]);

  if (!isOpen) return null;

  const canRevise = ["Sent", "Dropped", "Rejected", "Expired"].includes(
    quoteStatus
  );
  const canCalculate = ["Draft", "RFQ"].includes(quoteStatus);

  const actionButtons = [
    ...(canCalculate && onCalculatePricing
      ? [
          {
            icon: (
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
            ),
            label: "Calculate",
            onClick: () => {
              onCalculatePricing();
              onClose();
            },
          },
        ]
      : []),
    ...(canRevise
      ? [
          {
            icon: (
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            ),
            label: "Revise Quote",
            onClick: () => {
              onReviseQuote();
              onClose();
            },
          },
        ]
      : []),
    ...(onDownloadFiles
      ? [
          {
            icon: isDownloading ? (
              <svg
                className="w-5 h-5 animate-spin"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            ) : (
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
            ),
            label: isDownloading ? "Downloading..." : "Download",
            onClick: () => {
              if (!isDownloading) {
                onDownloadFiles();
                onClose();
              }
            },
            disabled: isDownloading,
          },
        ]
      : []),
  ];

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4 z-50 transition-colors duration-150"
    >
      <div className="flex gap-3">
        {actionButtons.map((action, index) => (
          <button
            key={index}
            className={`flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors group w-16 h-16 ${
              "disabled" in action && action.disabled
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-gray-50 dark:hover:bg-gray-700"
            }`}
            onClick={() => {
              if ("disabled" in action && action.disabled) return;
              if ("onClick" in action && action.onClick) {
                action.onClick();
              }
            }}
            disabled={"disabled" in action ? action.disabled : false}
          >
            <div className="text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {action.icon}
            </div>
            <span className="text-xs mt-2 text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors font-medium">
              {action.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
