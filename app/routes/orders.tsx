import { json, redirect } from "@remix-run/node"
import { useLoaderData, useFetcher } from "@remix-run/react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node"

import { getOrdersWithRelations, createOrder, updateOrder, deleteOrder } from "~/lib/orders"
import { getCustomers } from "~/lib/customers"
import { getVendors } from "~/lib/vendors"
import type { OrderWithRelations, OrderInput } from "~/lib/orders"

import Navbar from "~/components/Navbar"
import SearchHeader from "~/components/SearchHeader"
import Button from "~/components/shared/Button"
import Modal from "~/components/shared/Modal"
import { InputField, SelectField } from "~/components/shared/FormField"

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
          customer_id: formData.get("customer_id") ? parseInt(formData.get("customer_id") as string) : null,
          vendor_id: formData.get("vendor_id") ? parseInt(formData.get("vendor_id") as string) : null,
          status: formData.get("status") as any || 'Pending',
          total_price: formData.get("total_price") ? parseFloat(formData.get("total_price") as string) : null,
          vendor_pay: formData.get("vendor_pay") ? parseFloat(formData.get("vendor_pay") as string) : null,
          ship_date: formData.get("ship_date") as string || null,
        }
        await createOrder(orderData)
        break
      }
      case "update": {
        const id = parseInt(formData.get("id") as string)
        const orderData: Partial<OrderInput> = {
          customer_id: formData.get("customer_id") ? parseInt(formData.get("customer_id") as string) : null,
          vendor_id: formData.get("vendor_id") ? parseInt(formData.get("vendor_id") as string) : null,
          status: formData.get("status") as any,
          total_price: formData.get("total_price") ? parseFloat(formData.get("total_price") as string) : null,
          vendor_pay: formData.get("vendor_pay") ? parseFloat(formData.get("vendor_pay") as string) : null,
          ship_date: formData.get("ship_date") as string || null,
        }
        await updateOrder(id, orderData)
        break
      }
      case "delete": {
        const id = parseInt(formData.get("id") as string)
        await deleteOrder(id)
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
    order.customer?.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    order.vendor?.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    order.status.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleEdit = (order: OrderWithRelations) => {
    setEditingOrder(order)
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

  const handleDelete = (order: OrderWithRelations) => {
    if (confirm(`Are you sure you want to delete Order #${order.id}?`)) {
      fetcher.submit(
        { intent: "delete", id: order.id.toString() },
        { method: "post" }
      )
    }
  }

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
      case 'pending':
        return 'status-pending'
      case 'in_production':
        return 'status-in_production'
      case 'completed':
        return 'status-completed'
      case 'cancelled':
        return 'status-cancelled'
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
      <SearchHeader 
        breadcrumbs="Dashboard / Orders" 
        onSearch={setSearchQuery}
      />
      
      <div className="section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>Orders ({filteredOrders.length})</h2>
          <Button onClick={handleAdd}>Add Order</Button>
        </div>

        <table className="orders-table">
          <thead>
            <tr>
              <th>Order #</th>
              <th>Customer</th>
              <th>Vendor</th>
              <th>Status</th>
              <th>Total Price</th>
              <th>Vendor Pay</th>
              <th>Ship Date</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((order) => (
              <tr key={order.id}>
                <td>{order.id}</td>
                <td>{order.customer?.display_name || '--'}</td>
                <td>{order.vendor?.display_name || '--'}</td>
                <td className={`status ${getStatusClass(order.status)}`}>
                  {getStatusDisplay(order.status)}
                </td>
                <td>{formatCurrency(order.total_price)}</td>
                <td>{formatCurrency(order.vendor_pay)}</td>
                <td>{order.ship_date ? formatDate(order.ship_date) : '--'}</td>
                <td>{formatDate(order.created_at)}</td>
                <td>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button size="sm" onClick={() => handleEdit(order)}>
                      Edit
                    </Button>
                    <Button 
                      size="sm" 
                      variant="danger" 
                      onClick={() => handleDelete(order)}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredOrders.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: 'gray' }}>
            {searchQuery ? 'No orders found matching your search.' : 'No orders found. Add one to get started.'}
          </div>
        )}
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
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <SelectField
              label="Customer"
              name="customer_id"
              defaultValue={editingOrder?.customer_id?.toString() || ''}
            >
              <option value="">Select Customer</option>
              {customers.map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.display_name}
                </option>
              ))}
            </SelectField>
            
            <SelectField
              label="Vendor"
              name="vendor_id"
              defaultValue={editingOrder?.vendor_id?.toString() || ''}
            >
              <option value="">Select Vendor</option>
              {vendors.map(vendor => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.display_name}
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
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <InputField
              label="Total Price"
              name="total_price"
              type="number"
              step="0.01"
              defaultValue={editingOrder?.total_price?.toString() || ''}
            />
            
            <InputField
              label="Vendor Pay"
              name="vendor_pay"
              type="number"
              step="0.01"
              defaultValue={editingOrder?.vendor_pay?.toString() || ''}
            />
          </div>
          
          <InputField
            label="Ship Date"
            name="ship_date"
            type="date"
            defaultValue={editingOrder?.ship_date || ''}
          />

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
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