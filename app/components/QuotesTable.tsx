import type { Quote } from "~/lib/dashboard"

interface QuotesTableProps {
  quotes: Quote[]
}

export default function QuotesTable({ quotes }: QuotesTableProps) {
  const formatCurrency = (amount: number | null) => {
    if (!amount) return "--"
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  }

  const getStatusClass = (status: string) => {
    switch (status.toLowerCase()) {
      case 'draft':
        return 'status-draft'
      case 'sent':
        return 'status-sent'
      case 'accepted':
        return 'status-accepted'
      case 'rejected':
        return 'status-rejected'
      case 'expired':
        return 'status-expired'
      default:
        return ''
    }
  }

  return (
    <div className="section">
      <h2>Quotes</h2>
      <table className="orders-table">
        <thead>
          <tr>
            <th>Quote #</th>
            <th>Customer</th>
            <th>Vendor</th>
            <th>Status</th>
            <th>Qty</th>
            <th>Quote Amount</th>
            <th>Valid Until</th>
            <th>Date Created</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((quote) => (
            <tr key={quote.id}>
              <td>Q-{quote.id}</td>
              <td>{quote.customer_name}</td>
              <td>{quote.vendor_name}</td>
              <td className={`status ${getStatusClass(quote.status)}`}>
                {quote.status}
              </td>
              <td>{quote.quantity}</td>
              <td>{formatCurrency(quote.total_price)}</td>
              <td>{quote.valid_until ? formatDate(quote.valid_until) : '--'}</td>
              <td>{formatDate(quote.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}