import { useEffect, useRef } from "react";

interface OrderActionsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  excludeRef?: React.RefObject<HTMLElement>;
  onGenerateInvoice?: () => void;
  onGeneratePO?: () => void;
}

export default function OrderActionsDropdown({
  isOpen,
  onClose,
  excludeRef,
  onGenerateInvoice,
  onGeneratePO,
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
    ...(onGenerateInvoice
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
            label: "Invoice",
            onClick: () => {
              onGenerateInvoice();
              onClose();
            },
            disabled: true,
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
