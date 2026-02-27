import { json, redirect } from "@remix-run/node"
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node"

import { getCustomers, createCustomer, updateCustomer, archiveCustomer } from "~/lib/customers"
import type { Customer, CustomerInput, CustomerEventContext } from "~/lib/customers"
import { requireAuth, withAuthHeaders } from "~/lib/auth.server"

import SearchHeader from "~/components/SearchHeader"
import Button from "~/components/shared/Button"
import Modal from "~/components/shared/Modal"
import ViewToggle, { useViewToggle } from "~/components/shared/ViewToggle"
import { DataTable } from "~/components/shared/DataTable"
import { InputField, PhoneInputField } from "~/components/shared/FormField"
import { listCardStyles } from "~/utils/tw-styles"

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
  const { customers } = useLoaderData<typeof loader>()
  const fetcher = useFetcher()
  const navigate = useNavigate()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [customerType, setCustomerType] = useState<"business" | "individual">("business")
  const [view, setView] = useViewToggle("customers-view")

  const filteredCustomers = customers.filter((customer: Customer) =>
    customer.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    customer.phone?.includes(searchQuery)
  )

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

  const archiveIcon = (
    <svg
      className="w-[18px] h-[18px]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  )

  return (
    <div className="max-w-[1920px] mx-auto">
      <SearchHeader 
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Customers" }
        ]}
        onSearch={setSearchQuery}
      />
        
        <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
        <div className="flex justify-between items-center mb-5 gap-3">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-150">Customers ({filteredCustomers.length})</h2>
          <div className="flex items-center gap-3">
            <ViewToggle view={view} onChange={setView} />
            <Button onClick={handleAdd}>Add Customer</Button>
          </div>
        </div>

        <DataTable<Customer>
          data={filteredCustomers}
          viewMode={view}
          getRowKey={(customer) => customer.id}
          onRowClick={(customer) => navigate(`/customers/${customer.id}`)}
          emptyMessage={
            searchQuery
              ? "No customers found matching your search."
              : "No customers found. Add one to get started."
          }
          columns={[
            {
              key: "id",
              header: "ID",
              render: (customer) => customer.id,
            },
            {
              key: "name",
              header: "Name",
              render: (customer) => customer.displayName,
            },
            {
              key: "email",
              header: "Email",
              render: (customer) => customer.email || "--",
            },
            {
              key: "phone",
              header: "Phone",
              render: (customer) => customer.phone || "--",
            },
            {
              key: "created",
              header: "Created",
              render: (customer) => formatDate(customer.createdAt),
            },
          ]}
          rowActions={[
            {
              label: "Archive",
              icon: archiveIcon,
              variant: "danger",
              onClick: (customer) => handleDelete(customer),
            },
          ]}
          cardRender={(customer) => (
            <>
              <div className={listCardStyles.header}>
                <div className={listCardStyles.title}>{customer.displayName}</div>
              </div>
              <div className={listCardStyles.sectionGrid}>
                <div>
                  <div className={listCardStyles.label}>Email</div>
                  <div className={listCardStyles.value}>{customer.email || "--"}</div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Phone</div>
                  <div className={listCardStyles.value}>{customer.phone || "--"}</div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Created</div>
                  <div className={listCardStyles.value}>
                    {formatDate(customer.createdAt)}
                  </div>
                </div>
              </div>
            </>
          )}
        />
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