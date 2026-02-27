import { json, redirect } from "@remix-run/node"
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node"

import { getVendors, createVendor, updateVendor, archiveVendor } from "~/lib/vendors"
import type { Vendor, VendorInput, VendorEventContext } from "~/lib/vendors"
import { requireAuth, withAuthHeaders } from "~/lib/auth.server"

import SearchHeader from "~/components/SearchHeader"
import Button from "~/components/shared/Button"
import Modal from "~/components/shared/Modal"
import ViewToggle, { useViewToggle } from "~/components/shared/ViewToggle"
import { DataTable } from "~/components/shared/DataTable"
import { InputField, TextareaField, PhoneInputField } from "~/components/shared/FormField"
import { listCardStyles } from "~/utils/tw-styles"

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request)
  
  try {
    const vendors = await getVendors()

    return withAuthHeaders(
      json({ vendors, user, userDetails }),
      headers
    )
  } catch (error) {
    console.error("Vendors loader error:", error)
    return withAuthHeaders(
      json({ vendors: [], user, userDetails }),
      headers
    )
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request)
  const formData = await request.formData()
  const intent = formData.get("intent")

  const eventContext: VendorEventContext = {
    userId: user?.id,
    userEmail: user?.email || userDetails?.name || undefined,
  }

  try {
    switch (intent) {
      case "create": {
        const companyName = formData.get("companyName") as string || null
        const contactName = formData.get("contactName") as string || null

        // Auto-generate displayName: prefer companyName, fallback to contactName
        const displayName = companyName || contactName || "Unnamed Vendor"

        const vendorData: VendorInput = {
          displayName,
          companyName,
          contactName,
          email: formData.get("email") as string || null,
          phone: formData.get("phone") as string || null,
          address: formData.get("address") as string || null,
          notes: formData.get("notes") as string || null,
          discordId: formData.get("discordId") as string || null,
        }
        const newVendor = await createVendor(vendorData, eventContext)
        return redirect(`/vendors/${newVendor.id}`)
      }
      case "update": {
        const id = parseInt(formData.get("id") as string)
        const vendorData: Partial<VendorInput> = {
          displayName: formData.get("displayName") as string,
          companyName: formData.get("companyName") as string || null,
          contactName: formData.get("contactName") as string || null,
          email: formData.get("email") as string || null,
          phone: formData.get("phone") as string || null,
          address: formData.get("address") as string || null,
          notes: formData.get("notes") as string || null,
          discordId: formData.get("discordId") as string || null,
        }
        await updateVendor(id, vendorData, eventContext)
        return redirect("/vendors")
      }
      case "delete": {
        const id = parseInt(formData.get("id") as string)
        await archiveVendor(id, eventContext)
        return redirect("/vendors")
      }
    }
    return redirect("/vendors")
  } catch (error) {
    return json({ error: (error as Error).message }, { status: 400 })
  }
}

export default function Vendors() {
  const { vendors } = useLoaderData<typeof loader>()
  const fetcher = useFetcher()
  const navigate = useNavigate()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [vendorType, setVendorType] = useState<"business" | "individual">("business")
  const [view, setView] = useViewToggle("vendors-view")

  const filteredVendors = vendors.filter((vendor: Vendor) =>
    vendor.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    vendor.companyName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    vendor.contactName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    vendor.email?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleAdd = () => {
    setEditingVendor(null)
    setVendorType("business")
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingVendor(null)
  }

  const handleDelete = (vendor: Vendor) => {
    if (confirm(`Are you sure you want to archive ${vendor.displayName}? This will hide them from the list.`)) {
      fetcher.submit(
        { intent: "delete", id: vendor.id.toString() },
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
          { label: "Vendors" }
        ]}
        onSearch={setSearchQuery}
      />
        
      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
        <div className="flex justify-between items-center mb-5 gap-3">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-150">Vendors ({filteredVendors.length})</h2>
          <div className="flex items-center gap-3">
            <ViewToggle view={view} onChange={setView} />
            <Button onClick={handleAdd}>Add Vendor</Button>
          </div>
        </div>

        <DataTable<Vendor>
          data={filteredVendors}
          viewMode={view}
          getRowKey={(vendor) => vendor.id}
          onRowClick={(vendor) => navigate(`/vendors/${vendor.id}`)}
          emptyMessage={
            searchQuery
              ? "No vendors found matching your search."
              : "No vendors found. Add one to get started."
          }
          columns={[
            {
              key: "id",
              header: "ID",
              render: (vendor) => vendor.id,
            },
            {
              key: "displayName",
              header: "Display Name",
              render: (vendor) => vendor.displayName,
            },
            {
              key: "company",
              header: "Company",
              render: (vendor) => vendor.companyName || "--",
            },
            {
              key: "contact",
              header: "Contact",
              render: (vendor) => vendor.contactName || "--",
            },
            {
              key: "email",
              header: "Email",
              render: (vendor) => vendor.email || "--",
            },
            {
              key: "phone",
              header: "Phone",
              render: (vendor) => vendor.phone || "--",
            },
            {
              key: "created",
              header: "Created",
              render: (vendor) => formatDate(vendor.createdAt),
            },
          ]}
          rowActions={[
            {
              label: "Archive",
              icon: archiveIcon,
              variant: "danger",
              onClick: (vendor) => handleDelete(vendor),
            },
          ]}
          cardRender={(vendor) => (
            <>
              <div className={listCardStyles.header}>
                <div className={listCardStyles.title}>{vendor.displayName}</div>
              </div>
              <div className={listCardStyles.sectionGrid}>
                <div>
                  <div className={listCardStyles.label}>Company</div>
                  <div className={listCardStyles.value}>
                    {vendor.companyName || "--"}
                  </div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Contact</div>
                  <div className={listCardStyles.value}>
                    {vendor.contactName || "--"}
                  </div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Email</div>
                  <div className={listCardStyles.value}>{vendor.email || "--"}</div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Phone</div>
                  <div className={listCardStyles.value}>{vendor.phone || "--"}</div>
                </div>
              </div>
            </>
          )}
        />
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={editingVendor ? 'Quick Edit' : 'Add Vendor'}
      >
        <fetcher.Form method="post" onSubmit={handleCloseModal}>
          <input
            type="hidden"
            name="intent"
            value={editingVendor ? "update" : "create"}
          />
          {editingVendor && (
            <input type="hidden" name="id" value={editingVendor.id} />
          )}

          {/* Quick edit keeps the simple interface */}
          {editingVendor ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <InputField
                  label="Display Name"
                  name="displayName"
                  defaultValue={editingVendor.displayName}
                  required
                />

                <InputField
                  label="Company Name"
                  name="companyName"
                  defaultValue={editingVendor.companyName || ''}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <InputField
                  label="Contact Name"
                  name="contactName"
                  defaultValue={editingVendor.contactName || ''}
                />

                <InputField
                  label="Email"
                  name="email"
                  type="email"
                  defaultValue={editingVendor.email || ''}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <PhoneInputField
                  label="Phone"
                  name="phone"
                  defaultValue={editingVendor.phone || ''}
                />

                <InputField
                  label="Discord ID"
                  name="discordId"
                  defaultValue={editingVendor.discordId || ''}
                />
              </div>

              <TextareaField
                label="Address"
                name="address"
                defaultValue={editingVendor.address || ''}
              />

              <TextareaField
                label="Notes"
                name="notes"
                defaultValue={editingVendor.notes || ''}
              />
            </>
          ) : (
            <>
              {/* Vendor type selector for new vendors */}
              <div className="mb-4">
                <div className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Vendor Type
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="vendorType"
                      value="business"
                      checked={vendorType === "business"}
                      onChange={() => setVendorType("business")}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Business</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="vendorType"
                      value="individual"
                      checked={vendorType === "individual"}
                      onChange={() => setVendorType("individual")}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Individual</span>
                  </label>
                </div>
              </div>

              {vendorType === "business" ? (
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
                    label="Vendor Name"
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

              <InputField
                label="Discord ID"
                name="discordId"
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
              {editingVendor ? 'Update' : 'Create'} Vendor
            </Button>
          </div>
        </fetcher.Form>
      </Modal>
    </div>
  )
}