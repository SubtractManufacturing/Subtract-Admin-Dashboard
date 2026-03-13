import { Link } from "@remix-run/react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  breadcrumbs: BreadcrumbItem[];
  onSearch?: (query: string) => void;
}

export default function AdminPageHeader({ breadcrumbs, onSearch }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-2 border-b border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10 dark:border-slate-700">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-sm">
        {breadcrumbs.map((item, index) => (
          <span key={index} className="flex items-center gap-1.5">
            {item.href ? (
              <Link
                to={item.href}
                className="font-medium text-gray-500 no-underline transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              >
                {item.label}
              </Link>
            ) : (
              <span className="font-medium text-gray-900 dark:text-white">{item.label}</span>
            )}
            {index < breadcrumbs.length - 1 && (
              <span className="text-gray-300 dark:text-slate-600">/</span>
            )}
          </span>
        ))}
      </nav>

      {/* Inline search */}
      {onSearch && (
        <div className="relative w-full sm:w-64">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            placeholder="Search"
            onChange={(e) => onSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder-gray-500 dark:focus:border-slate-500"
          />
        </div>
      )}
    </div>
  );
}
