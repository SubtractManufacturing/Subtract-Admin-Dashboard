import type { Quote } from "~/lib/dashboard"
import { listCardStyles, tableStyles, statusStyles } from "~/utils/tw-styles"
import { useNavigate } from "@remix-run/react"
import ViewToggle, { useViewToggle } from "./shared/ViewToggle"

interface QuotesTableProps {
  quotes: Quote[]
}

export default function QuotesTable({ quotes }: QuotesTableProps) {
  const navigate = useNavigate()
  const [view, setView] = useViewToggle("dashboard-quotes-view")
  
  const formatCurrency = (amount: string | null) => {
    if (!amount) return "--"
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat(amount))
  }

  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  }

  const getStatusStyle = (status: string) => {
    switch (status.toLowerCase()) {
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
        <h2 className="text-2xl font-semibold">Quotes</h2>
        <ViewToggle view={view} onChange={setView} />
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
              {quotes.map((quote) => (
                <tr
                  key={quote.id}
                  className={`${tableStyles.row} cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800`}
                  onClick={() => navigate(`/quotes/${quote.id}`)}
                >
                  <td className={tableStyles.cell}>{quote.quote_number}</td>
                  <td className={tableStyles.cell}>
                    {quote.customer_id ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/customers/${quote.customer_id}`)
                        }}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                      >
                        {quote.customer_name}
                      </button>
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
          {quotes.map((quote) => (
            <div
              key={quote.id}
              role="button"
              tabIndex={0}
              className={`${listCardStyles.card} ${listCardStyles.clickableCard}`}
              onClick={() => navigate(`/quotes/${quote.id}`)}
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
  )
}