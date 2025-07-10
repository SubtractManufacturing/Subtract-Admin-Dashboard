import { json, redirect } from "@remix-run/node"
import { useLoaderData, useFetcher } from "@remix-run/react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node"

import { getCustomers, createCustomer, updateCustomer, archiveCustomer } from "~/lib/customers"
import type { Customer, CustomerInput } from "~/lib/customers"

import Navbar from "~/components/Navbar"
import SearchHeader from "~/components/SearchHeader"
import Button from "~/components/shared/Button"
import Modal from "~/components/shared/Modal"
import { InputField } from "~/components/shared/FormField"
import { tableStyles } from "~/utils/tw-styles"

export async function loader() {
  const customers = await getCustomers()
  return json({ customers })
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData()
  const intent = formData.get("intent")

  try {
    switch (intent) {
      case "create": {
        const customerData: CustomerInput = {
          displayName: formData.get("displayName") as string,
          email: formData.get("email") as string || null,
          phone: formData.get("phone") as string || null,
        }
        await createCustomer(customerData)
        break
      }
      case "update": {
        const id = parseInt(formData.get("id") as string)
        const customerData: Partial<CustomerInput> = {
          displayName: formData.get("displayName") as string,
          email: formData.get("email") as string || null,
          phone: formData.get("phone") as string || null,
        }
        await updateCustomer(id, customerData)
        break
      }
      case "delete": {
        const id = parseInt(formData.get("id") as string)
        await archiveCustomer(id)
        break
      }
    }
    return redirect("/customers")
  } catch (error) {
    return json({ error: (error as Error).message }, { status: 400 })
  }
}

export default function Customers() {
  const { customers } = useLoaderData<typeof loader>()
  const fetcher = useFetcher()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const filteredCustomers = customers.filter(customer =>
    customer.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.phone?.includes(searchQuery)
  )

  const handleEdit = (customer: typeof customers[0]) => {
    setEditingCustomer(customer as any)
    setIsModalOpen(true)
  }

  const handleAdd = () => {
    setEditingCustomer(null)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingCustomer(null)
  }

  const handleDelete = (customer: typeof customers[0]) => {
    if (confirm(`Are you sure you want to archive ${customer.displayName}? This will hide them from the list.`)) {
      fetcher.submit(
        { intent: "delete", id: customer.id.toString() },
        { method: "post" }
      )
    }
  }

  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  }

  return (
    <div>
      <Navbar />
      <SearchHeader 
        breadcrumbs="Dashboard / Customers" 
        onSearch={setSearchQuery}
      />
      
      <div className="px-10 py-8">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-2xl font-semibold">Customers ({filteredCustomers.length})</h2>
          <Button onClick={handleAdd}>Add Customer</Button>
        </div>

        <table className={tableStyles.container}>
          <thead className={tableStyles.header}>
            <tr>
              <th className={tableStyles.headerCell}>ID</th>
              <th className={tableStyles.headerCell}>Name</th>
              <th className={tableStyles.headerCell}>Email</th>
              <th className={tableStyles.headerCell}>Phone</th>
              <th className={tableStyles.headerCell}>Created</th>
              <th className={tableStyles.headerCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCustomers.map((customer) => (
              <tr key={customer.id} className={tableStyles.row}>
                <td className={tableStyles.cell}>{customer.id}</td>
                <td className={tableStyles.cell}>{customer.displayName}</td>
                <td className={tableStyles.cell}>{customer.email || '--'}</td>
                <td className={tableStyles.cell}>{customer.phone || '--'}</td>
                <td className={tableStyles.cell}>{formatDate(customer.createdAt)}</td>
                <td className={tableStyles.cell}>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleEdit(customer)}>
                      Edit
                    </Button>
                    <Button 
                      size="sm" 
                      variant="danger" 
                      onClick={() => handleDelete(customer)}
                    >
                      Archive
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredCustomers.length === 0 && (
          <div className={tableStyles.emptyState}>
            {searchQuery ? 'No customers found matching your search.' : 'No customers found. Add one to get started.'}
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={editingCustomer ? 'Edit Customer' : 'Add Customer'}
      >
        <fetcher.Form method="post" onSubmit={handleCloseModal}>
          <input 
            type="hidden" 
            name="intent" 
            value={editingCustomer ? "update" : "create"} 
          />
          {editingCustomer && (
            <input type="hidden" name="id" value={editingCustomer.id} />
          )}
          
          <InputField
            label="Name"
            name="displayName"
            defaultValue={editingCustomer?.displayName || ''}
            required
          />
          
          <InputField
            label="Email"
            name="email"
            type="email"
            defaultValue={editingCustomer?.email || ''}
          />
          
          <InputField
            label="Phone"
            name="phone"
            type="tel"
            defaultValue={editingCustomer?.phone || ''}
          />

          <div className="flex gap-3 justify-end mt-6">
            <Button type="button" variant="secondary" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button type="submit">
              {editingCustomer ? 'Update' : 'Create'} Customer
            </Button>
          </div>
        </fetcher.Form>
      </Modal>
    </div>
  )
}