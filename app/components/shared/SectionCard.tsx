import type { ReactNode } from "react";

interface SectionCardProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function SectionCard({
  title,
  actions,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 ${className ?? ""}`}
    >
      <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {title}
        </h3>
        {actions}
      </div>
      <div className={contentClassName ?? "p-6"}>{children}</div>
    </div>
  );
}
