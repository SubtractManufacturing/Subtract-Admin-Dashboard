import { json, redirect } from "@remix-run/node"
import { useLoaderData, useFetcher, Link } from "@remix-run/react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node"

import { getVendors, createVendor, updateVendor, archiveVendor } from "~/lib/vendors"
import type { Vendor, VendorInput } from "~/lib/vendors"
import { requireAuth, withAuthHeaders } from "~/lib/auth.server"

import Navbar from "~/components/Navbar"
import SearchHeader from "~/components/SearchHeader"
import Button from "~/components/shared/Button"
import Modal from "~/components/shared/Modal"
import { InputField, TextareaField } from "~/components/shared/FormField"
import { tableStyles } from "~/utils/tw-styles"

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
  const formData = await request.formData()
  const intent = formData.get("intent")

  try {
    switch (intent) {
      case "create": {
        const vendorData: VendorInput = {
          displayName: formData.get("displayName") as string,
          companyName: formData.get("companyName") as string || null,
          contactName: formData.get("contactName") as string || null,
          email: formData.get("email") as string || null,
          phone: formData.get("phone") as string || null,
          address: formData.get("address") as string || null,
          notes: formData.get("notes") as string || null,
          discordId: formData.get("discordId") as string || null,
        }
        await createVendor(vendorData)
        break
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
        await updateVendor(id, vendorData)
        break
      }
      case "delete": {
        const id = parseInt(formData.get("id") as string)
        await archiveVendor(id)
        break
      }
    }
    return redirect("/vendors")
  } catch (error) {
    return json({ error: (error as Error).message }, { status: 400 })
  }
}

export default function Vendors() {
  const { vendors, user, userDetails } = useLoaderData<typeof loader>()
  const fetcher = useFetcher()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const filteredVendors = vendors.filter(vendor =>
    vendor.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    vendor.companyName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    vendor.contactName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    vendor.email?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleEdit = (vendor: typeof vendors[0]) => {
    setEditingVendor(vendor as any)
    setIsModalOpen(true)
  }

  const handleAdd = () => {
    setEditingVendor(null)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingVendor(null)
  }

  const handleDelete = (vendor: typeof vendors[0]) => {
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

  return (
    <div>
      <Navbar 
        userName={userDetails?.name || user.email} 
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
      />
      <div className="max-w-[1920px] mx-auto">
        <SearchHeader 
          breadcrumbs="Dashboard / Vendors" 
          onSearch={setSearchQuery}
        />
        
        <div className="px-10 py-8">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-150">Vendors ({filteredVendors.length})</h2>
          <Button onClick={handleAdd}>Add Vendor</Button>
        </div>

        <table className={tableStyles.container}>
          <thead className={tableStyles.header}>
            <tr>
              <th className={tableStyles.headerCell}>ID</th>
              <th className={tableStyles.headerCell}>Display Name</th>
              <th className={tableStyles.headerCell}>Company</th>
              <th className={tableStyles.headerCell}>Contact</th>
              <th className={tableStyles.headerCell}>Email</th>
              <th className={tableStyles.headerCell}>Phone</th>
              <th className={tableStyles.headerCell}>Created</th>
              <th className={tableStyles.headerCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredVendors.map((vendor) => (
              <tr key={vendor.id} className={`${tableStyles.row} cursor-pointer hover:bg-gray-50`}>
                <td className={tableStyles.cell}>
                  <Link to={`/vendors/${vendor.id}`} className="block">
                    {vendor.id}
                  </Link>
                </td>
                <td className={tableStyles.cell}>
                  <Link to={`/vendors/${vendor.id}`} className="block">
                    {vendor.displayName}
                  </Link>
                </td>
                <td className={tableStyles.cell}>
                  <Link to={`/vendors/${vendor.id}`} className="block">
                    {vendor.companyName || '--'}
                  </Link>
                </td>
                <td className={tableStyles.cell}>
                  <Link to={`/vendors/${vendor.id}`} className="block">
                    {vendor.contactName || '--'}
                  </Link>
                </td>
                <td className={tableStyles.cell}>
                  <Link to={`/vendors/${vendor.id}`} className="block">
                    {vendor.email || '--'}
                  </Link>
                </td>
                <td className={tableStyles.cell}>
                  <Link to={`/vendors/${vendor.id}`} className="block">
                    {vendor.phone || '--'}
                  </Link>
                </td>
                <td className={tableStyles.cell}>
                  <Link to={`/vendors/${vendor.id}`} className="block">
                    {formatDate(vendor.createdAt)}
                  </Link>
                </td>
                <td className={tableStyles.cell}>
                  <div className="flex space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEdit(vendor)
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
                        handleDelete(vendor)
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

        {filteredVendors.length === 0 && (
          <div className={tableStyles.emptyState}>
            {searchQuery ? 'No vendors found matching your search.' : 'No vendors found. Add one to get started.'}
          </div>
        )}
      </div>

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
          
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Display Name"
              name="displayName"
              defaultValue={editingVendor?.displayName || ''}
              required
            />
            
            <InputField
              label="Company Name"
              name="companyName"
              defaultValue={editingVendor?.companyName || ''}
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Contact Name"
              name="contactName"
              defaultValue={editingVendor?.contactName || ''}
            />
            
            <InputField
              label="Email"
              name="email"
              type="email"
              defaultValue={editingVendor?.email || ''}
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Phone"
              name="phone"
              type="tel"
              defaultValue={editingVendor?.phone || ''}
            />
            
            <InputField
              label="Discord ID"
              name="discordId"
              defaultValue={editingVendor?.discordId || ''}
            />
          </div>
          
          <TextareaField
            label="Address"
            name="address"
            defaultValue={editingVendor?.address || ''}
          />
          
          <TextareaField
            label="Notes"
            name="notes"
            defaultValue={editingVendor?.notes || ''}
          />

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