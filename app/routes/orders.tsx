import { json, redirect } from "@remix-run/node"
import { useLoaderData, useFetcher } from "@remix-run/react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node"

import { getOrdersWithRelations, createOrder, updateOrder, archiveOrder } from "~/lib/orders.js"
import { getCustomers } from "~/lib/customers.js"
import { getVendors } from "~/lib/vendors.js"
import type { OrderWithRelations, OrderInput } from "~/lib/orders.js"

import Navbar from "~/components/Navbar"
import SearchHeader from "~/components/SearchHeader"
import Button from "~/components/shared/Button"
import Modal from "~/components/shared/Modal"
import { InputField, SelectField } from "~/components/shared/FormField"
import { tableStyles, statusStyles } from "~/utils/tw-styles"

export async function loader() {
  const [orders, customers, vendors] = await Promise.all([
    getOrdersWithRelations(),
    getCustomers(),
    getVendors()
  ])
  return json({ orders, customers, vendors })
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData()
  const intent = formData.get("intent")

  try {
    switch (intent) {
      case "create": {
        const orderData: OrderInput = {
          customerId: formData.get("customerId") ? parseInt(formData.get("customerId") as string) : null,
          vendorId: formData.get("vendorId") ? parseInt(formData.get("vendorId") as string) : null,
          status: formData.get("status") as 'Pending' | 'In_Production' | 'Completed' | 'Cancelled' | 'Archived' || 'Pending',
          totalPrice: formData.get("totalPrice") as string || null,
          vendorPay: formData.get("vendorPay") as string || null,
          shipDate: formData.get("shipDate") ? new Date(formData.get("shipDate") as string) : null,
        }
        await createOrder(orderData)
        break
      }
      case "update": {
        const id = parseInt(formData.get("id") as string)
        const orderData: Partial<OrderInput> = {
          customerId: formData.get("customerId") ? parseInt(formData.get("customerId") as string) : null,
          vendorId: formData.get("vendorId") ? parseInt(formData.get("vendorId") as string) : null,
          status: formData.get("status") as 'Pending' | 'In_Production' | 'Completed' | 'Cancelled' | 'Archived',
          totalPrice: formData.get("totalPrice") as string || null,
          vendorPay: formData.get("vendorPay") as string || null,
          shipDate: formData.get("shipDate") ? new Date(formData.get("shipDate") as string) : null,
        }
        await updateOrder(id, orderData)
        break
      }
      case "delete": {
        const id = parseInt(formData.get("id") as string)
        await archiveOrder(id)
        break
      }
    }
    return redirect("/orders")
  } catch (error) {
    return json({ error: (error as Error).message }, { status: 400 })
  }
}

export default function Orders() {
  const { orders, customers, vendors } = useLoaderData<typeof loader>()
  const fetcher = useFetcher()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<OrderWithRelations | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const filteredOrders = orders.filter(order =>
    order.id.toString().includes(searchQuery) ||
    order.customer?.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    order.vendor?.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    order.status.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleEdit = (order: typeof orders[0]) => {
    setEditingOrder(order as any)
    setIsModalOpen(true)
  }

  const handleAdd = () => {
    setEditingOrder(null)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingOrder(null)
  }

  const handleDelete = (order: typeof orders[0]) => {
    if (confirm(`Are you sure you want to archive Order #${order.id}? This will hide it from the list.`)) {
      fetcher.submit(
        { intent: "delete", id: order.id.toString() },
        { method: "post" }
      )
    }
  }

  const formatCurrency = (amount: string | number | null) => {
    if (!amount) return "--"
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(numAmount)
  }

  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  }

  const getStatusClass = (status: string) => {
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
    <div>
      <Navbar />
      <div className="max-w-[1920px] mx-auto">
        <SearchHeader 
          breadcrumbs="Dashboard / Orders" 
          onSearch={setSearchQuery}
        />
        
        <div className="px-10 py-8">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-150">Orders ({filteredOrders.length})</h2>
          <Button onClick={handleAdd}>Add Order</Button>
        </div>

        <table className={tableStyles.container}>
          <thead className={tableStyles.header}>
            <tr>
              <th className={tableStyles.headerCell}>Order #</th>
              <th className={tableStyles.headerCell}>Customer</th>
              <th className={tableStyles.headerCell}>Vendor</th>
              <th className={tableStyles.headerCell}>Status</th>
              <th className={tableStyles.headerCell}>Total Price</th>
              <th className={tableStyles.headerCell}>Vendor Pay</th>
              <th className={tableStyles.headerCell}>Ship Date</th>
              <th className={tableStyles.headerCell}>Created</th>
              <th className={tableStyles.headerCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((order) => (
              <tr key={order.id} className={tableStyles.row}>
                <td className={tableStyles.cell}>{order.id}</td>
                <td className={tableStyles.cell}>{order.customer?.displayName || '--'}</td>
                <td className={tableStyles.cell}>{order.vendor?.displayName || '--'}</td>
                <td className={`${tableStyles.cell} ${statusStyles.base} ${getStatusClass(order.status)}`}>
                  {getStatusDisplay(order.status)}
                </td>
                <td className={tableStyles.cell}>{formatCurrency(order.totalPrice)}</td>
                <td className={tableStyles.cell}>{formatCurrency(order.vendorPay)}</td>
                <td className={tableStyles.cell}>{order.shipDate ? formatDate(order.shipDate) : '--'}</td>
                <td className={tableStyles.cell}>{formatDate(order.createdAt)}</td>
                <td className={tableStyles.cell}>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleEdit(order)}>
                      Edit
                    </Button>
                    <Button 
                      size="sm" 
                      variant="danger" 
                      onClick={() => handleDelete(order)}
                    >
                      Archive
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredOrders.length === 0 && (
          <div className={tableStyles.emptyState}>
            {searchQuery ? 'No orders found matching your search.' : 'No orders found. Add one to get started.'}
          </div>
        )}
      </div>

      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={editingOrder ? 'Edit Order' : 'Add Order'}
      >
        <fetcher.Form method="post" onSubmit={handleCloseModal}>
          <input 
            type="hidden" 
            name="intent" 
            value={editingOrder ? "update" : "create"} 
          />
          {editingOrder && (
            <input type="hidden" name="id" value={editingOrder.id} />
          )}
          
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label="Customer"
              name="customerId"
              defaultValue={editingOrder?.customerId?.toString() || ''}
            >
              <option value="">Select Customer</option>
              {customers.map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.displayName}
                </option>
              ))}
            </SelectField>
            
            <SelectField
              label="Vendor"
              name="vendorId"
              defaultValue={editingOrder?.vendorId?.toString() || ''}
            >
              <option value="">Select Vendor</option>
              {vendors.map(vendor => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.displayName}
                </option>
              ))}
            </SelectField>
          </div>
          
          <SelectField
            label="Status"
            name="status"
            defaultValue={editingOrder?.status || 'Pending'}
            required
          >
            <option value="Pending">Pending</option>
            <option value="In_Production">In Production</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </SelectField>
          
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Total Price"
              name="totalPrice"
              type="number"
              step="0.01"
              defaultValue={editingOrder?.totalPrice?.toString() || ''}
            />
            
            <InputField
              label="Vendor Pay"
              name="vendorPay"
              type="number"
              step="0.01"
              defaultValue={editingOrder?.vendorPay?.toString() || ''}
            />
          </div>
          
          <InputField
            label="Ship Date"
            name="shipDate"
            type="date"
            defaultValue={editingOrder?.shipDate ? new Date(editingOrder.shipDate).toISOString().split('T')[0] : ''}
          />

          <div className="flex gap-3 justify-end mt-6">
            <Button type="button" variant="secondary" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button type="submit">
              {editingOrder ? 'Update' : 'Create'} Order
            </Button>
          </div>
        </fetcher.Form>
      </Modal>
    </div>
  )
}