import type { Order } from "~/lib/dashboard"
import { listCardStyles, tableStyles, statusStyles } from "~/utils/tw-styles"
import { useNavigate, Link, useSearchParams, useSubmit } from "@remix-run/react"
import ViewToggle, { useViewToggle } from "./shared/ViewToggle"

const LIST_LIMITS = [10, 25, 50] as const

function isDashboardListLimit(n: number): n is (typeof LIST_LIMITS)[number] {
  return n === 10 || n === 25 || n === 50
}

interface OrdersTableProps {
  orders: Order[]
}

function openInNewTab(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}

export default function OrdersTable({ orders }: OrdersTableProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const submit = useSubmit()
  const [view, setView] = useViewToggle("dashboard-orders-view")

  const rawOrdersLimit = Number(searchParams.get("ordersLimit"))
  const ordersLimit = isDashboardListLimit(rawOrdersLimit) ? rawOrdersLimit : 10

  const setOrdersLimit = (nextLimit: number) => {
    const next = new URLSearchParams(searchParams)
    next.set("ordersLimit", String(nextLimit))
    submit(next, { method: "get", preventScrollReset: true, replace: true })
  }

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
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-2xl font-semibold">Orders</h2>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <div
            role="radiogroup"
            aria-label="How many orders to show"
            className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden flex-shrink-0"
          >
            {LIST_LIMITS.map((limit, i) => {
              const selected = ordersLimit === limit
              return (
                <button
                  key={limit}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setOrdersLimit(limit)}
                  title={`Show ${limit}`}
                  className={`px-3 py-2 text-sm font-semibold transition-colors ${i > 0 ? "border-l border-gray-300 dark:border-gray-600" : ""} ${
                    selected
                      ? "bg-blue-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  {limit}
                </button>
              )
            })}
          </div>
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {view === "list" ? (
        <div className="overflow-x-auto">
          <table className={tableStyles.container}>
            <thead className={tableStyles.header}>
              <tr>
                <th className={tableStyles.headerCell}>Order #</th>
                <th className={tableStyles.headerCell}>Customer</th>
                <th className={tableStyles.headerCell}>Vendor</th>
                <th className={tableStyles.headerCell}>Status</th>
                <th className={tableStyles.headerCell}>Items</th>
                <th className={tableStyles.headerCell}>PO Amount</th>
                <th className={tableStyles.headerCell}>Delivery Date</th>
                <th className={tableStyles.headerCell}>Date Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className={`${tableStyles.row} cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800`}
                  onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                  onClick={(e) => handleRowClick(e, `/orders/${order.order_number}`)}
                  onAuxClick={(e) => handleRowAuxClick(e, `/orders/${order.order_number}`)}
                >
                  <td className={tableStyles.cell}>
                    <Link
                      to={`/orders/${order.order_number}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                    >
                      {order.order_number}
                    </Link>
                  </td>
                  <td className={tableStyles.cell}>
                    {order.customer_id ? (
                      <Link
                        to={`/customers/${order.customer_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                      >
                        {order.customer_name}
                      </Link>
                    ) : (
                      <span>{order.customer_name}</span>
                    )}
                  </td>
                  <td className={tableStyles.cell}>
                    {order.vendor_id ? (
                      <Link
                        to={`/vendors/${order.vendor_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                      >
                        {order.vendor_name}
                      </Link>
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
                    {order.delivery_date ? formatDate(order.delivery_date) : '--'}
                  </td>
                  <td className={tableStyles.cell}>
                    {formatDate(order.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={listCardStyles.grid}>
          {orders.map((order) => (
            <div
              key={order.id}
              role="button"
              tabIndex={0}
              className={`${listCardStyles.card} ${listCardStyles.clickableCard}`}
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              onClick={(e) => handleRowClick(e, `/orders/${order.order_number}`)}
              onAuxClick={(e) => handleRowAuxClick(e, `/orders/${order.order_number}`)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/orders/${order.order_number}`); } }}
            >
              <div className={listCardStyles.header}>
                <div className={listCardStyles.title}>{order.order_number}</div>
                <div className={`${statusStyles.base} ${getStatusStyle(order.status)} text-sm`}>
                  {getStatusDisplay(order.status)}
                </div>
              </div>
              <div className={listCardStyles.sectionGrid}>
                <div>
                  <div className={listCardStyles.label}>Customer</div>
                  <div className={listCardStyles.value}>{order.customer_name || "--"}</div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Vendor</div>
                  <div className={listCardStyles.value}>{order.vendor_name || "--"}</div>
                </div>
                <div>
                  <div className={listCardStyles.label}>PO Amount</div>
                  <div className={listCardStyles.value}>{formatCurrency(order.po_amount)}</div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Delivery Date</div>
                  <div className={listCardStyles.value}>{order.delivery_date ? formatDate(order.delivery_date) : "--"}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}