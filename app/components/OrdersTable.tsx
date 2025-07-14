import type { Order } from "~/lib/dashboard.js"
import { tableStyles, statusStyles } from "~/utils/tw-styles.js"

interface OrdersTableProps {
  orders: Order[]
}

export default function OrdersTable({ orders }: OrdersTableProps) {
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
      case 'pending':
        return statusStyles.pending
      case 'in_production':
        return statusStyles.inProduction
      case 'completed':
        return statusStyles.completed
      case 'cancelled':
        return statusStyles.cancelled
      case 'archived':
        return statusStyles.archived
      default:
        return ''
    }
  }

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'In_Production':
        return 'In Production'
      default:
        return status
    }
  }

  return (
    <div className="px-10 py-8">
      <h2 className="text-2xl font-semibold mb-4">Orders</h2>
      <table className={tableStyles.container}>
        <thead className={tableStyles.header}>
          <tr>
            <th className={tableStyles.headerCell}>Order #</th>
            <th className={tableStyles.headerCell}>Customer</th>
            <th className={tableStyles.headerCell}>Vendor</th>
            <th className={tableStyles.headerCell}>Status</th>
            <th className={tableStyles.headerCell}>Qty</th>
            <th className={tableStyles.headerCell}>PO Amount</th>
            <th className={tableStyles.headerCell}>Due Date</th>
            <th className={tableStyles.headerCell}>Date Created</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className={tableStyles.row}>
              <td className={tableStyles.cell}>{order.id}</td>
              <td className={tableStyles.cell}>{order.customer_name}</td>
              <td className={tableStyles.cell}>{order.vendor_name}</td>
              <td className={`${tableStyles.cell} ${statusStyles.base} ${getStatusStyle(order.status)}`}>
                {getStatusDisplay(order.status)}
              </td>
              <td className={tableStyles.cell}>{order.quantity}</td>
              <td className={tableStyles.cell}>{formatCurrency(order.po_amount)}</td>
              <td className={tableStyles.cell}>{order.ship_date ? formatDate(order.ship_date) : '--'}</td>
              <td className={tableStyles.cell}>{formatDate(order.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}