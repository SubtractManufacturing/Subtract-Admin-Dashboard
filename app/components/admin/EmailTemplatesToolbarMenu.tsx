import { useEffect, useRef, type RefObject } from "react";
import { BookOpen } from "lucide-react";

type EmailTemplatesToolbarMenuProps = {
  isOpen: boolean;
  onClose: () => void;
  excludeRef?: RefObject<HTMLElement | null>;
  onViewMergeTokenDocs: () => void;
};

/**
 * Submenu for the email templates section toolbar (ellipsis button).
 * Small list menu, same interaction pattern as AccountDropdown / actions menus.
 */
export function EmailTemplatesToolbarMenu({
  isOpen,
  onClose,
  excludeRef,
  onViewMergeTokenDocs,
}: EmailTemplatesToolbarMenuProps) {
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

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-full z-50 mt-1 min-w-[11.5rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
      role="menu"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-slate-700"
        role="menuitem"
        onClick={() => {
          onViewMergeTokenDocs();
          onClose();
        }}
      >
        <BookOpen
          className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
          strokeWidth={2}
          aria-hidden
        />
        View docs
      </button>
    </div>
  );
}
