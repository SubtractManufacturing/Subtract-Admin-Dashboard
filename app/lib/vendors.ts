import { db } from "./db/index.js"
import { vendors, orders, customers } from "./db/schema.js"
import { eq, desc } from 'drizzle-orm'
import type { Vendor } from "./db/schema.js"
import { getVendorAttachments } from "./attachments.js"
import { createEvent } from "./events.js"

export type { Vendor }

export type VendorInput = {
  displayName: string
  companyName?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  notes?: string | null
  discordId?: string | null
}

export type VendorEventContext = {
  userId?: string
  userEmail?: string
}

export async function getVendors(): Promise<Vendor[]> {
  try {
    const result = await db
      .select()
      .from(vendors)
      .where(eq(vendors.isArchived, false))
      .orderBy(desc(vendors.createdAt))

    return result
  } catch (error) {
    console.error('Error fetching vendors:', error)
    return []
  }
}

export async function getVendor(id: number): Promise<Vendor | null> {
  try {
    const result = await db
      .select()
      .from(vendors)
      .where(eq(vendors.id, id))
      .limit(1)

    return result[0] || null
  } catch (error) {
    throw new Error(`Failed to get vendor: ${error}`)
  }
}

export async function createVendor(vendorData: VendorInput, eventContext?: VendorEventContext): Promise<Vendor> {
  try {
    const result = await db
      .insert(vendors)
      .values(vendorData)
      .returning()

    const vendor = result[0]

    // Log event for vendor creation
    await createEvent({
      entityType: "vendor",
      entityId: vendor.id.toString(),
      eventType: "vendor_created",
      eventCategory: "system",
      title: `Vendor "${vendor.displayName}" created`,
      description: `New vendor added to the system`,
      metadata: {
        displayName: vendor.displayName,
        companyName: vendor.companyName,
        email: vendor.email,
        phone: vendor.phone
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })

    return vendor
  } catch (error) {
    throw new Error(`Failed to create vendor: ${error}`)
  }
}

export async function updateVendor(id: number, vendorData: Partial<VendorInput>, eventContext?: VendorEventContext): Promise<Vendor> {
  try {
    const result = await db
      .update(vendors)
      .set(vendorData)
      .where(eq(vendors.id, id))
      .returning()

    const vendor = result[0]

    // Log event for vendor update
    await createEvent({
      entityType: "vendor",
      entityId: id.toString(),
      eventType: "vendor_updated",
      eventCategory: "system",
      title: `Vendor information updated`,
      description: `Vendor "${vendor.displayName}" details were updated`,
      metadata: vendorData,
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })

    return vendor
  } catch (error) {
    throw new Error(`Failed to update vendor: ${error}`)
  }
}

export async function deleteVendor(id: number): Promise<void> {
  try {
    await db
      .delete(vendors)
      .where(eq(vendors.id, id))
  } catch (error) {
    throw new Error(`Failed to delete vendor: ${error}`)
  }
}

export async function archiveVendor(id: number, eventContext?: VendorEventContext): Promise<void> {
  try {
    const [vendor] = await db
      .update(vendors)
      .set({ isArchived: true })
      .where(eq(vendors.id, id))
      .returning()

    // Log event for vendor archival
    await createEvent({
      entityType: "vendor",
      entityId: id.toString(),
      eventType: "vendor_archived",
      eventCategory: "system",
      title: `Vendor archived`,
      description: `Vendor "${vendor.displayName}" has been archived`,
      metadata: {
        displayName: vendor.displayName
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })
  } catch (error) {
    throw new Error(`Failed to archive vendor: ${error}`)
  }
}

export async function getVendorOrders(vendorId: number) {
  try {
    const result = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        vendorId: orders.vendorId,
        status: orders.status,
        totalPrice: orders.totalPrice,
        vendorPay: orders.vendorPay,
        shipDate: orders.shipDate,
        createdAt: orders.createdAt,
        customer: customers
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(eq(orders.vendorId, vendorId))
      .orderBy(desc(orders.createdAt))

    return result
  } catch (error) {
    console.error('Error fetching vendor orders:', error)
    return []
  }
}

export async function getVendorStats(vendorId: number) {
  try {
    const vendorOrders = await getVendorOrders(vendorId)

    const stats = {
      totalOrders: vendorOrders.length,
      activeOrders: vendorOrders.filter(o => o.status === 'In_Production' || o.status === 'Pending').length,
      completedOrders: vendorOrders.filter(o => o.status === 'Completed').length,
      totalEarnings: vendorOrders.reduce((sum, o) => {
        // totalPrice is stored and maintained when line items change
        const orderTotal = parseFloat(o.totalPrice || '0')
        const vendorPayPercentage = parseFloat(o.vendorPay || '0')
        const vendorEarnings = (orderTotal * vendorPayPercentage) / 100
        return sum + vendorEarnings
      }, 0),
      averageLeadTime: 0
    }

    return stats
  } catch (error) {
    console.error('Error fetching vendor stats:', error)
    return {
      totalOrders: 0,
      activeOrders: 0,
      completedOrders: 0,
      totalEarnings: 0,
      averageLeadTime: 0
    }
  }
}

export async function getVendorWithAttachments(vendorId: number) {
  try {
    const vendor = await getVendor(vendorId)
    if (!vendor) return null
    
    const attachments = await getVendorAttachments(vendorId)
    
    return {
      ...vendor,
      attachments
    }
  } catch (error) {
    console.error('Error fetching vendor with attachments:', error)
    return null
  }
}