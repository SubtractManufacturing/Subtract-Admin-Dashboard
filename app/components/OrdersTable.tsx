import type { Order } from "~/lib/dashboard"
import { tableStyles, statusStyles } from "~/utils/tw-styles"
import { useNavigate } from "@remix-run/react"

interface OrdersTableProps {
  orders: Order[]
}

export default function OrdersTable({ orders }: OrdersTableProps) {
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
      case 'pending':
        return statusStyles.pending
      case 'waiting_for_shop_selection':
        return statusStyles.waitingForShopSelection
      case 'in_production':
        return statusStyles.inProduction
      case 'in_inspection':
        return statusStyles.inInspection
      case 'shipped':
        return statusStyles.shipped
      case 'delivered':
        return statusStyles.delivered
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
      case 'Waiting_For_Shop_Selection':
        return 'Waiting for Shop Selection'
      case 'In_Production':
        return 'In Production'
      case 'In_Inspection':
        return 'In Inspection'
      case 'Shipped':
        return 'Shipped'
      case 'Delivered':
        return 'Delivered'
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
            <th className={tableStyles.headerCell}>Items</th>
            <th className={tableStyles.headerCell}>PO Amount</th>
            <th className={tableStyles.headerCell}>Due Date</th>
            <th className={tableStyles.headerCell}>Date Created</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr 
              key={order.id} 
              className={`${tableStyles.row} cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800`}
              onClick={() => navigate(`/orders/${order.order_number}`)}
            >
              <td className={tableStyles.cell}>
                {order.order_number}
              </td>
              <td className={tableStyles.cell}>
                {order.customer_id ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/customers/${order.customer_id}`)
                    }}
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                  >
                    {order.customer_name}
                  </button>
                ) : (
                  <span>{order.customer_name}</span>
                )}
              </td>
              <td className={tableStyles.cell}>
                {order.vendor_id ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/vendors/${order.vendor_id}`)
                    }}
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                  >
                    {order.vendor_name}
                  </button>
                ) : (
                  <span>{order.vendor_name}</span>
                )}
              </td>
              <td className={`${tableStyles.cell} ${statusStyles.base} ${getStatusStyle(order.status)}`}>
                {getStatusDisplay(order.status)}
              </td>
              <td className={tableStyles.cell}>
                {order.quantity}
              </td>
              <td className={tableStyles.cell}>
                {formatCurrency(order.po_amount)}
              </td>
              <td className={tableStyles.cell}>
                {order.ship_date ? formatDate(order.ship_date) : '--'}
              </td>
              <td className={tableStyles.cell}>
                {formatDate(order.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}