import { db } from "./db/index.js"
import { customers, orders, vendors } from "./db/schema.js"
import { eq, desc } from 'drizzle-orm'
import type { Customer } from "./db/schema.js"
import { getCustomerAttachments } from "./attachments.js"
import { createEvent } from "./events.js"

export type { Customer }

export type CustomerInput = {
  displayName: string
  email?: string | null
  phone?: string | null
}

export type CustomerEventContext = {
  userId?: string
  userEmail?: string
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

export async function createCustomer(customerData: CustomerInput, eventContext?: CustomerEventContext): Promise<Customer> {
  try {
    const result = await db
      .insert(customers)
      .values(customerData)
      .returning()

    const customer = result[0]

    // Log event for customer creation
    await createEvent({
      entityType: "customer",
      entityId: customer.id.toString(),
      eventType: "customer_created",
      eventCategory: "system",
      title: `Customer "${customer.displayName}" created`,
      description: `New customer added to the system`,
      metadata: {
        displayName: customer.displayName,
        email: customer.email,
        phone: customer.phone
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })

    return customer
  } catch (error) {
    throw new Error(`Failed to create customer: ${error}`)
  }
}

export async function updateCustomer(id: number, customerData: Partial<CustomerInput>, eventContext?: CustomerEventContext): Promise<Customer> {
  try {
    const result = await db
      .update(customers)
      .set(customerData)
      .where(eq(customers.id, id))
      .returning()

    const customer = result[0]

    // Log event for customer update
    await createEvent({
      entityType: "customer",
      entityId: id.toString(),
      eventType: "customer_updated",
      eventCategory: "system",
      title: `Customer information updated`,
      description: `Customer "${customer.displayName}" details were updated`,
      metadata: customerData,
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })

    return customer
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

export async function archiveCustomer(id: number, eventContext?: CustomerEventContext): Promise<void> {
  try {
    const [customer] = await db
      .update(customers)
      .set({ isArchived: true })
      .where(eq(customers.id, id))
      .returning()

    // Log event for customer archival
    await createEvent({
      entityType: "customer",
      entityId: id.toString(),
      eventType: "customer_archived",
      eventCategory: "system",
      title: `Customer archived`,
      description: `Customer "${customer.displayName}" has been archived`,
      metadata: {
        displayName: customer.displayName
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })
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
      activeOrders: customerOrders.filter(o => o.status === 'In_Production' || o.status === 'Pending').length,
      completedOrders: customerOrders.filter(o => o.status === 'Completed').length,
      totalSpent: customerOrders.reduce((sum, o) => sum + parseFloat(o.totalPrice || '0'), 0)
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