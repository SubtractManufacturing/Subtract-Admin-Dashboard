import type { Quote } from "~/lib/dashboard"
import { tableStyles, statusStyles } from "~/utils/tw-styles"
import { useNavigate } from "@remix-run/react"

interface QuotesTableProps {
  quotes: Quote[]
}

export default function QuotesTable({ quotes }: QuotesTableProps) {
  const navigate = useNavigate()
  
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
    <div className="px-10 py-8">
      <h2 className="text-2xl font-semibold mb-4">Quotes</h2>
      <table className={tableStyles.container}>
        <thead className={tableStyles.header}>
          <tr>
            <th className={tableStyles.headerCell}>Quote #</th>
            <th className={tableStyles.headerCell}>Customer</th>
            <th className={tableStyles.headerCell}>Vendor</th>
            <th className={tableStyles.headerCell}>Status</th>
            <th className={tableStyles.headerCell}>Qty</th>
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
              <td className={tableStyles.cell}>
                {quote.vendor_id ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/vendors/${quote.vendor_id}`)
                    }}
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                  >
                    {quote.vendor_name}
                  </button>
                ) : (
                  <span>{quote.vendor_name}</span>
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
  )
}