import { Form } from "@remix-run/react"

interface SearchHeaderProps {
  breadcrumbs: string
  onSearch?: (query: string) => void
}

export default function SearchHeader({ breadcrumbs, onSearch }: SearchHeaderProps) {
  return (
    <div className="header-row">
      <div className="breadcrumbs">{breadcrumbs}</div>
      <div className="search-container">
        <Form className="search-box" method="get">
          <svg
            className="search-icon"
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
            className="search-input"
            name="q"
            onChange={(e) => onSearch?.(e.target.value)}
          />
        </Form>
      </div>
    </div>
  )
}