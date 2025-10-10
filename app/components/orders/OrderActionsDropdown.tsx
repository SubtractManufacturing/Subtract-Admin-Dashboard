import { useEffect, useRef } from "react";

interface OrderActionsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  excludeRef?: React.RefObject<HTMLElement>;
  onGenerateInvoice?: () => void;
  onGeneratePO?: () => void;
  onManageVendor?: () => void;
  hasVendor?: boolean;
}

export default function OrderActionsDropdown({
  isOpen,
  onClose,
  excludeRef,
  onGenerateInvoice, // eslint-disable-line @typescript-eslint/no-unused-vars
  onGeneratePO,
  onManageVendor,
  hasVendor = false,
}: OrderActionsDropdownProps) {
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

  const actionButtons = [
    ...(onManageVendor
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
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            ),
            label: "Vendor",
            onClick: () => {
              onManageVendor();
              onClose();
            },
            disabled: false,
          },
        ]
      : []),
    ...(onGeneratePO
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
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
            ),
            label: "PO",
            onClick: () => {
              onGeneratePO();
              onClose();
            },
            disabled: !hasVendor,
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
        {actionButtons.map((action, index) => {
          const isDisabled = "disabled" in action && action.disabled;
          const isPOButton = action.label === "PO";
          const showTooltip = isDisabled && isPOButton;

          return (
            <div key={index} className="relative group/tooltip">
              <button
                className={`flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors group w-16 h-16 ${
                  isDisabled
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
                onClick={() => {
                  if (isDisabled) return;
                  if ("onClick" in action && action.onClick) {
                    action.onClick();
                  }
                }}
                disabled={isDisabled}
              >
                <div className="text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {action.icon}
                </div>
                <span className="text-xs mt-2 text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors font-medium">
                  {action.label}
                </span>
              </button>
              {showTooltip && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-opacity duration-200 pointer-events-none z-[60]">
                  Purchase Orders require a vendor
                  <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700"></div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
