import { db } from "./db/index.js"
import { customers, orders, vendors } from "./db/schema.js"
import { eq, desc } from 'drizzle-orm'
import type { Customer } from "./db/schema.js"
import { getCustomerAttachments } from "./attachments.js"

export type { Customer }

export type CustomerInput = {
  displayName: string
  email?: string | null
  phone?: string | null
}

export async function getCustomers(): Promise<Customer[]> {
  try {
    const result = await db
      .select()
      .from(customers)
      .where(eq(customers.isArchived, false))
      .orderBy(desc(customers.createdAt))

    return result
  } catch (error) {
    console.error('Error fetching customers:', error)
    return []
  }
}

export async function getCustomer(id: number): Promise<Customer | null> {
  try {
    const result = await db
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1)

    return result[0] || null
  } catch (error) {
    throw new Error(`Failed to get customer: ${error}`)
  }
}

export async function createCustomer(customerData: CustomerInput): Promise<Customer> {
  try {
    const result = await db
      .insert(customers)
      .values(customerData)
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to create customer: ${error}`)
  }
}

export async function updateCustomer(id: number, customerData: Partial<CustomerInput>): Promise<Customer> {
  try {
    const result = await db
      .update(customers)
      .set(customerData)
      .where(eq(customers.id, id))
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to update customer: ${error}`)
  }
}

export async function deleteCustomer(id: number): Promise<void> {
  try {
    await db
      .delete(customers)
      .where(eq(customers.id, id))
  } catch (error) {
    throw new Error(`Failed to delete customer: ${error}`)
  }
}

export async function archiveCustomer(id: number): Promise<void> {
  try {
    await db
      .update(customers)
      .set({ isArchived: true })
      .where(eq(customers.id, id))
  } catch (error) {
    throw new Error(`Failed to archive customer: ${error}`)
  }
}

export async function getCustomerOrders(customerId: number) {
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
        vendor: vendors
      })
      .from(orders)
      .leftJoin(vendors, eq(orders.vendorId, vendors.id))
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.createdAt))

    return result
  } catch (error) {
    console.error('Error fetching customer orders:', error)
    return []
  }
}

export async function getCustomerStats(customerId: number) {
  try {
    const customerOrders = await getCustomerOrders(customerId)
    
    const stats = {
      totalOrders: customerOrders.length,
      activeOrders: customerOrders.filter((o: any) => o.status === 'In_Production' || o.status === 'Pending').length,
      completedOrders: customerOrders.filter((o: any) => o.status === 'Completed').length,
      totalSpent: customerOrders.reduce((sum: number, o: any) => sum + parseFloat(o.totalPrice || '0'), 0)
    }
    
    return stats
  } catch (error) {
    console.error('Error fetching customer stats:', error)
    return {
      totalOrders: 0,
      activeOrders: 0,
      completedOrders: 0,
      totalSpent: 0
    }
  }
}

export async function getCustomerWithAttachments(customerId: number) {
  try {
    const customer = await getCustomer(customerId)
    if (!customer) return null
    
    const attachments = await getCustomerAttachments(customerId)
    
    return {
      ...customer,
      attachments
    }
  } catch (error) {
    console.error('Error fetching customer with attachments:', error)
    return null
  }
}