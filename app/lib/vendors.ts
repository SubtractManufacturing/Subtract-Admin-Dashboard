import { db } from "./db/index.js"
import { vendors, orders, customers } from "./db/schema.js"
import { eq, desc } from 'drizzle-orm'
import type { Vendor } from "./db/schema.js"

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

export async function createVendor(vendorData: VendorInput): Promise<Vendor> {
  try {
    const result = await db
      .insert(vendors)
      .values(vendorData)
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to create vendor: ${error}`)
  }
}

export async function updateVendor(id: number, vendorData: Partial<VendorInput>): Promise<Vendor> {
  try {
    const result = await db
      .update(vendors)
      .set(vendorData)
      .where(eq(vendors.id, id))
      .returning()

    return result[0]
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

export async function archiveVendor(id: number): Promise<void> {
  try {
    await db
      .update(vendors)
      .set({ isArchived: true })
      .where(eq(vendors.id, id))
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
      activeOrders: vendorOrders.filter((o: any) => o.status === 'In_Production' || o.status === 'Pending').length,
      completedOrders: vendorOrders.filter((o: any) => o.status === 'Completed').length,
      totalEarnings: vendorOrders.reduce((sum: number, o: any) => sum + parseFloat(o.vendorPay || '0'), 0),
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