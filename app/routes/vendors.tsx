import { json, redirect } from "@remix-run/node"
import { useLoaderData, useFetcher } from "@remix-run/react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node"

import { getVendors, createVendor, updateVendor, archiveVendor } from "~/lib/vendors"
import type { Vendor, VendorInput } from "~/lib/vendors"

import Navbar from "~/components/Navbar"
import SearchHeader from "~/components/SearchHeader"
import Button from "~/components/shared/Button"
import Modal from "~/components/shared/Modal"
import { InputField, TextareaField } from "~/components/shared/FormField"

export async function loader() {
  const vendors = await getVendors()
  return json({ vendors })
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
  const { vendors } = useLoaderData<typeof loader>()
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
      <Navbar />
      <SearchHeader 
        breadcrumbs="Dashboard / Vendors" 
        onSearch={setSearchQuery}
      />
      
      <div className="section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>Vendors ({filteredVendors.length})</h2>
          <Button onClick={handleAdd}>Add Vendor</Button>
        </div>

        <table className="orders-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Display Name</th>
              <th>Company</th>
              <th>Contact</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredVendors.map((vendor) => (
              <tr key={vendor.id}>
                <td>{vendor.id}</td>
                <td>{vendor.displayName}</td>
                <td>{vendor.companyName || '--'}</td>
                <td>{vendor.contactName || '--'}</td>
                <td>{vendor.email || '--'}</td>
                <td>{vendor.phone || '--'}</td>
                <td>{formatDate(vendor.createdAt)}</td>
                <td>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button size="sm" onClick={() => handleEdit(vendor)}>
                      Edit
                    </Button>
                    <Button 
                      size="sm" 
                      variant="danger" 
                      onClick={() => handleDelete(vendor)}
                    >
                      Archive
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredVendors.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: 'gray' }}>
            {searchQuery ? 'No vendors found matching your search.' : 'No vendors found. Add one to get started.'}
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={editingVendor ? 'Edit Vendor' : 'Add Vendor'}
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
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
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
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
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
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
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
          
          <InputField
            label="Address"
            name="address"
            defaultValue={editingVendor?.address || ''}
          />
          
          <TextareaField
            label="Notes"
            name="notes"
            defaultValue={editingVendor?.notes || ''}
            rows={3}
          />

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
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