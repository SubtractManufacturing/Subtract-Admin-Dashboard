import { json, redirect } from "@remix-run/node"
import { useLoaderData, useFetcher, Link } from "@remix-run/react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node"

import { getCustomers, createCustomer, updateCustomer, archiveCustomer } from "~/lib/customers"
import type { Customer, CustomerInput, CustomerEventContext } from "~/lib/customers"
import { requireAuth, withAuthHeaders } from "~/lib/auth.server"

import SearchHeader from "~/components/SearchHeader"
import Button from "~/components/shared/Button"
import Modal from "~/components/shared/Modal"
import { InputField, PhoneInputField } from "~/components/shared/FormField"
import { tableStyles } from "~/utils/tw-styles"

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request)
  
  try {
    const customers = await getCustomers()
    return withAuthHeaders(
      json({ customers, user, userDetails }),
      headers
    )
  } catch (error) {
    console.error("Customers loader error:", error)
    return withAuthHeaders(
      json({ customers: [], user, userDetails }),
      headers
    )
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request)
  const formData = await request.formData()
  const intent = formData.get("intent")

  const eventContext: CustomerEventContext = {
    userId: user?.id,
    userEmail: user?.email || userDetails?.name || undefined,
  }

  try {
    switch (intent) {
      case "create": {
        const companyName = formData.get("companyName") as string || null
        const contactName = formData.get("contactName") as string || null

        // Auto-generate displayName: prefer companyName, fallback to contactName
        const displayName = companyName || contactName || "Unnamed Customer"

        const customerData: CustomerInput = {
          displayName,
          companyName,
          contactName,
          email: formData.get("email") as string || null,
          phone: formData.get("phone") as string || null,
        }
        const newCustomer = await createCustomer(customerData, eventContext)
        return redirect(`/customers/${newCustomer.id}`)
      }
      case "update": {
        const id = parseInt(formData.get("id") as string)
        const customerData: Partial<CustomerInput> = {
          displayName: formData.get("displayName") as string,
          email: formData.get("email") as string || null,
          phone: formData.get("phone") as string || null,
        }
        await updateCustomer(id, customerData, eventContext)
        return redirect("/customers")
      }
      case "delete": {
        const id = parseInt(formData.get("id") as string)
        await archiveCustomer(id, eventContext)
        return redirect("/customers")
      }
    }
    return redirect("/customers")
  } catch (error) {
    return json({ error: (error as Error).message }, { status: 400 })
  }
}

export default function Customers() {
  const { customers, user, userDetails } = useLoaderData<typeof loader>()
  const fetcher = useFetcher()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [customerType, setCustomerType] = useState<"business" | "individual">("business")

  const filteredCustomers = customers.filter((customer: Customer) =>
    customer.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.phone?.includes(searchQuery)
  )

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer)
    setIsModalOpen(true)
  }

  const handleAdd = () => {
    setEditingCustomer(null)
    setCustomerType("business")
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingCustomer(null)
  }

  const handleDelete = (customer: Customer) => {
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
    <div className="max-w-[1920px] mx-auto">
      <SearchHeader 
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Customers" }
        ]}
        onSearch={setSearchQuery}
      />
        
        <div className="px-10 py-8">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-150">Customers ({filteredCustomers.length})</h2>
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
            {filteredCustomers.map((customer: Customer) => (
              <tr key={customer.id} className={`${tableStyles.row} cursor-pointer hover:bg-gray-50`}>
                <td className={tableStyles.cell}>
                  <Link to={`/customers/${customer.id}`} className="block">
                    {customer.id}
                  </Link>
                </td>
                <td className={tableStyles.cell}>
                  <Link to={`/customers/${customer.id}`} className="block">
                    {customer.displayName}
                  </Link>
                </td>
                <td className={tableStyles.cell}>
                  <Link to={`/customers/${customer.id}`} className="block">
                    {customer.email || '--'}
                  </Link>
                </td>
                <td className={tableStyles.cell}>
                  <Link to={`/customers/${customer.id}`} className="block">
                    {customer.phone || '--'}
                  </Link>
                </td>
                <td className={tableStyles.cell}>
                  <Link to={`/customers/${customer.id}`} className="block">
                    {formatDate(customer.createdAt)}
                  </Link>
                </td>
                <td className={tableStyles.cell}>
                  <div className="flex space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEdit(customer)
                      }}
                      className="p-1.5 text-white bg-blue-600 rounded hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors duration-150"
                      title="Quick Edit"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        fill="currentColor"
                        viewBox="0 0 16 16"
                      >
                        <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(customer)
                      }}
                      className="p-1.5 text-white bg-red-600 rounded hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 transition-colors duration-150"
                      title="Archive"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        fill="currentColor"
                        viewBox="0 0 16 16"
                      >
                        <path d="M12.643 15C13.979 15 15 13.845 15 12.5V5H1v7.5C1 13.845 2.021 15 3.357 15h9.286zM5.5 7h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1zM.8 1a.8.8 0 0 0-.8.8V3a.8.8 0 0 0 .8.8h14.4A.8.8 0 0 0 16 3V1.8a.8.8 0 0 0-.8-.8H.8z"/>
                      </svg>
                    </button>
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
        title={editingCustomer ? 'Quick Edit' : 'Add Customer'}
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

          {/* Quick edit keeps the simple interface */}
          {editingCustomer ? (
            <>
              <InputField
                label="Name"
                name="displayName"
                defaultValue={editingCustomer.displayName}
                required
              />

              <InputField
                label="Email"
                name="email"
                type="email"
                defaultValue={editingCustomer.email || ''}
              />

              <PhoneInputField
                label="Phone"
                name="phone"
                defaultValue={editingCustomer.phone || ''}
              />
            </>
          ) : (
            <>
              {/* Customer type selector for new customers */}
              <div className="mb-4">
                <div className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Customer Type
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="customerType"
                      value="business"
                      checked={customerType === "business"}
                      onChange={() => setCustomerType("business")}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Business</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="customerType"
                      value="individual"
                      checked={customerType === "individual"}
                      onChange={() => setCustomerType("individual")}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Individual</span>
                  </label>
                </div>
              </div>

              {customerType === "business" ? (
                <>
                  <InputField
                    label="Company Name"
                    name="companyName"
                    required
                  />

                  <InputField
                    label="Contact Person (optional)"
                    name="contactName"
                  />
                </>
              ) : (
                <>
                  <InputField
                    label="Customer Name"
                    name="contactName"
                    required
                  />
                </>
              )}

              <InputField
                label="Email"
                name="email"
                type="email"
              />

              <PhoneInputField
                label="Phone"
                name="phone"
              />

              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Additional details like addresses and payment terms can be added after creation.
              </p>
            </>
          )}

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