import { Form } from "@remix-run/react"
import Breadcrumbs from "./Breadcrumbs"

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface SearchHeaderProps {
  breadcrumbs: string | BreadcrumbItem[]
  onSearch?: (query: string) => void
}

export default function SearchHeader({ breadcrumbs, onSearch }: SearchHeaderProps) {
  // Handle both string and array formats for backward compatibility
  const breadcrumbItems: BreadcrumbItem[] = typeof breadcrumbs === 'string' 
    ? breadcrumbs.split(' / ').map(label => ({ label }))
    : breadcrumbs;

  return (
    <div className="flex justify-between items-center px-10 py-2.5">
      <Breadcrumbs items={breadcrumbItems} />
      <div className="max-w-md flex-shrink-0">
        <Form className="bg-white dark:bg-gray-800 border border-gray-400 dark:border-gray-600 rounded flex items-center px-4 py-2 shadow-sm transition-colors duration-150" method="get">
          <svg
            className="text-gray-500 dark:text-gray-400 mr-2.5 transition-colors duration-150"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
          </svg>
          <input
            type="search"
            placeholder="Search"
            className="border-none outline-none w-full text-sm font-semibold bg-transparent text-gray-800 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 transition-colors duration-150"
            name="q"
            onChange={(e) => onSearch?.(e.target.value)}
          />
        </Form>
      </div>
    </div>
  )
}