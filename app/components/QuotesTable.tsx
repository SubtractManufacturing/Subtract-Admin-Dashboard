import type { Quote } from "~/lib/dashboard"
import { listCardStyles, tableStyles, statusStyles } from "~/utils/tw-styles"
import { useNavigate, Link } from "@remix-run/react"
import ViewToggle, { useViewToggle } from "./shared/ViewToggle"
import { useState } from "react"
import { Filter } from "lucide-react"

interface QuotesTableProps {
  quotes: Quote[]
  showFilters?: boolean
}

const QUOTE_STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "RFQ", label: "RFQ" },
  { value: "Draft", label: "Draft" },
  { value: "Sent", label: "Sent" },
  { value: "Accepted", label: "Accepted" },
  { value: "Rejected", label: "Rejected" },
  { value: "Expired", label: "Expired" },
] as const;

type FilterValue = typeof QUOTE_STATUS_FILTERS[number]["value"];

function openInNewTab(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}

export default function QuotesTable({ quotes, showFilters = true }: QuotesTableProps) {
  const navigate = useNavigate()
  const [view, setView] = useViewToggle("dashboard-quotes-view")
  const [statusFilter, setStatusFilter] = useState<FilterValue>("all")

  
  // Filter quotes based on status
  const filteredQuotes = statusFilter === "all" 
    ? quotes 
    : quotes.filter(quote => quote.status === statusFilter);

  const handleRowClick = (e: React.MouseEvent<HTMLElement>, href: string) => {
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      openInNewTab(href);
      return;
    }
    navigate(href);
  };

  const handleRowAuxClick = (e: React.MouseEvent<HTMLElement>, href: string) => {
    if (e.defaultPrevented) return;
    if (e.button === 1) {
      e.preventDefault();
      openInNewTab(href);
    }
  };

  const formatCurrency = (amount: string | null) => {
    if (!amount) return "--"
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat(amount))
  };

  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  const getStatusStyle = (status: string) => {
    switch (status.toLowerCase()) {
      case 'rfq':
        return statusStyles.pending
      case 'draft':
        return statusStyles.draft
      case 'sent':
        return statusStyles.sent
      case 'accepted':
        return statusStyles.accepted
      case 'rejected':
        return statusStyles.rejected
      case 'expired':
        return statusStyles.expired
      default:
        return ''
    }
  }

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          📝 Quotes
        </h2>
        <div className="flex items-center gap-3">
          {showFilters && (
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as FilterValue)}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {QUOTE_STATUS_FILTERS.map(filter => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {view === "list" ? (
        <div className="overflow-x-auto">
          <table className={tableStyles.container}>
            <thead className={tableStyles.header}>
              <tr>
                <th className={tableStyles.headerCell}>Quote #</th>
                <th className={tableStyles.headerCell}>Customer</th>
                <th className={tableStyles.headerCell}>Status</th>
                <th className={tableStyles.headerCell}>Items</th>
                <th className={tableStyles.headerCell}>Quote Amount</th>
                <th className={tableStyles.headerCell}>Valid Until</th>
                <th className={tableStyles.headerCell}>Date Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuotes.map((quote) => (
                <tr
                  key={quote.id}
                  className={`${tableStyles.row} cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800`}
                  onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                  onClick={(e) => handleRowClick(e, `/quotes/${quote.id}`)}
                  onAuxClick={(e) => handleRowAuxClick(e, `/quotes/${quote.id}`)}
                >
                  <td className={tableStyles.cell}>
                    <Link
                      to={`/quotes/${quote.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                    >
                      {quote.quote_number}
                    </Link>
                  </td>
                  <td className={tableStyles.cell}>
                    {quote.customer_id ? (
                      <Link
                        to={`/customers/${quote.customer_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                      >
                        {quote.customer_name}
                      </Link>
                    ) : (
                      <span>{quote.customer_name}</span>
                    )}
                  </td>
                  <td className={`${tableStyles.cell} ${statusStyles.base} ${getStatusStyle(quote.status)}`}>
                    {quote.status}
                  </td>
                  <td className={tableStyles.cell}>{quote.quantity}</td>
                  <td className={tableStyles.cell}>{formatCurrency(quote.total_price)}</td>
                  <td className={tableStyles.cell}>{quote.valid_until ? formatDate(quote.valid_until) : '--'}</td>
                  <td className={tableStyles.cell}>{formatDate(quote.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={listCardStyles.grid}>
          {filteredQuotes.map((quote) => (
            <div
              key={quote.id}
              role="button"
              tabIndex={0}
              className={`${listCardStyles.card} ${listCardStyles.clickableCard}`}
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              onClick={(e) => handleRowClick(e, `/quotes/${quote.id}`)}
              onAuxClick={(e) => handleRowAuxClick(e, `/quotes/${quote.id}`)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/quotes/${quote.id}`); } }}
            >
              <div className={listCardStyles.header}>
                <div className={listCardStyles.title}>{quote.quote_number}</div>
                <div className={`${statusStyles.base} ${getStatusStyle(quote.status)} text-sm`}>
                  {quote.status}
                </div>
              </div>
              <div className={listCardStyles.sectionGrid}>
                <div>
                  <div className={listCardStyles.label}>Customer</div>
                  <div className={listCardStyles.value}>{quote.customer_name || "--"}</div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Items</div>
                  <div className={listCardStyles.value}>{quote.quantity}</div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Total</div>
                  <div className={listCardStyles.value}>{formatCurrency(quote.total_price)}</div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Valid Until</div>
                  <div className={listCardStyles.value}>{quote.valid_until ? formatDate(quote.valid_until) : "--"}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
