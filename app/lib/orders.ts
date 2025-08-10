import { db } from "./db/index.js"
import { orders, customers, vendors, orderLineItems } from "./db/schema.js"
import { eq, desc, ne } from 'drizzle-orm'
import type { Customer, Vendor, OrderLineItem } from "./db/schema.js"
import { getNextOrderNumber } from "./number-generator.js"
import { getOrderAttachments } from "./attachments.js"

export type OrderWithRelations = {
  id: number
  orderNumber: string
  customerId: number | null
  vendorId: number | null
  quoteId: number | null
  status: 'Pending' | 'In_Production' | 'Completed' | 'Cancelled' | 'Archived'
  totalPrice: string | null
  vendorPay: string | null
  shipDate: Date | null
  notes: string | null
  leadTime: number | null
  createdAt: Date
  updatedAt: Date
  customer?: Customer | null
  vendor?: Vendor | null
  lineItems?: OrderLineItem[]
}

export type OrderInput = {
  orderNumber?: string | null
  customerId?: number | null
  vendorId?: number | null
  quoteId?: number | null
  status?: 'Pending' | 'In_Production' | 'Completed' | 'Cancelled' | 'Archived'
  vendorPay?: string | null
  shipDate?: Date | null
}

export async function getOrdersWithRelations(): Promise<OrderWithRelations[]> {
  try {
    const result = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        vendorId: orders.vendorId,
        quoteId: orders.quoteId,
        status: orders.status,
        totalPrice: orders.totalPrice,
        vendorPay: orders.vendorPay,
        shipDate: orders.shipDate,
        notes: orders.notes,
        leadTime: orders.leadTime,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customer: customers,
        vendor: vendors
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(vendors, eq(orders.vendorId, vendors.id))
      .where(ne(orders.status, 'Archived'))
      .orderBy(desc(orders.createdAt))

    // Fetch line items for each order
    const ordersWithLineItems = await Promise.all(
      result.map(async (order) => {
        const lineItems = await db
          .select()
          .from(orderLineItems)
          .where(eq(orderLineItems.orderId, order.id))
        
        return {
          ...order,
          lineItems
        }
      })
    )

    return ordersWithLineItems
  } catch (error) {
    console.error('Error fetching orders:', error)
    return []
  }
}

export async function getOrder(id: number): Promise<OrderWithRelations | null> {
  try {
    const result = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        vendorId: orders.vendorId,
        quoteId: orders.quoteId,
        status: orders.status,
        totalPrice: orders.totalPrice,
        vendorPay: orders.vendorPay,
        shipDate: orders.shipDate,
        notes: orders.notes,
        leadTime: orders.leadTime,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customer: customers,
        vendor: vendors
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(vendors, eq(orders.vendorId, vendors.id))
      .where(eq(orders.id, id))
      .limit(1)

    return result[0] || null
  } catch (error) {
    throw new Error(`Failed to get order: ${error}`)
  }
}

export async function getOrderByNumber(orderNumber: string): Promise<OrderWithRelations | null> {
  try {
    const result = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        vendorId: orders.vendorId,
        quoteId: orders.quoteId,
        status: orders.status,
        totalPrice: orders.totalPrice,
        vendorPay: orders.vendorPay,
        shipDate: orders.shipDate,
        notes: orders.notes,
        leadTime: orders.leadTime,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customer: customers,
        vendor: vendors
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(vendors, eq(orders.vendorId, vendors.id))
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1)

    return result[0] || null
  } catch (error) {
    throw new Error(`Failed to get order by number: ${error}`)
  }
}

export async function checkOrderNumberExists(orderNumber: string): Promise<boolean> {
  try {
    const result = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1)

    return result.length > 0
  } catch (error) {
    console.error(`Failed to check order number: ${error}`)
    return false
  }
}

export async function createOrder(orderData: OrderInput): Promise<OrderWithRelations> {
  try {
    // Use provided orderNumber or generate a new one
    const orderNumber = orderData.orderNumber || await getNextOrderNumber()
    
    // Remove orderNumber from orderData to avoid duplication
    const { ...orderDataWithoutNumber } = orderData
    delete orderDataWithoutNumber.orderNumber
    
    const insertResult = await db
      .insert(orders)
      .values({
        ...orderDataWithoutNumber,
        orderNumber: orderNumber as string
      })
      .returning()

    const newOrder = insertResult[0]

    const result = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        vendorId: orders.vendorId,
        quoteId: orders.quoteId,
        status: orders.status,
        totalPrice: orders.totalPrice,
        vendorPay: orders.vendorPay,
        shipDate: orders.shipDate,
        notes: orders.notes,
        leadTime: orders.leadTime,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customer: customers,
        vendor: vendors
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(vendors, eq(orders.vendorId, vendors.id))
      .where(eq(orders.id, newOrder.id))
      .limit(1)

    return result[0]
  } catch (error) {
    throw new Error(`Failed to create order: ${error}`)
  }
}

export async function updateOrder(id: number, orderData: Partial<OrderInput>): Promise<OrderWithRelations> {
  try {
    // Filter out null values for orderNumber since it's required in the database
    const { orderNumber, ...restData } = orderData;
    const updateData = orderNumber === null 
      ? restData 
      : { ...restData, ...(orderNumber !== undefined && { orderNumber }) };
    
    await db
      .update(orders)
      .set(updateData)
      .where(eq(orders.id, id))

    const result = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        vendorId: orders.vendorId,
        quoteId: orders.quoteId,
        status: orders.status,
        totalPrice: orders.totalPrice,
        vendorPay: orders.vendorPay,
        shipDate: orders.shipDate,
        notes: orders.notes,
        leadTime: orders.leadTime,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customer: customers,
        vendor: vendors
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(vendors, eq(orders.vendorId, vendors.id))
      .where(eq(orders.id, id))
      .limit(1)

    return result[0]
  } catch (error) {
    throw new Error(`Failed to update order: ${error}`)
  }
}

export async function deleteOrder(id: number): Promise<void> {
  try {
    await db
      .delete(orders)
      .where(eq(orders.id, id))
  } catch (error) {
    throw new Error(`Failed to delete order: ${error}`)
  }
}

export async function archiveOrder(id: number): Promise<void> {
  try {
    await db
      .update(orders)
      .set({ status: 'Archived' })
      .where(eq(orders.id, id))
  } catch (error) {
    throw new Error(`Failed to archive order: ${error}`)
  }
}

export async function getOrderWithAttachments(id: number) {
  const order = await getOrder(id)
  if (!order) return null

  const attachments = await getOrderAttachments(id)
  
  return {
    ...order,
    attachments
  }
}

export async function getOrderByNumberWithAttachments(orderNumber: string) {
  const order = await getOrderByNumber(orderNumber)
  if (!order) return null

  const attachments = await getOrderAttachments(order.id)
  
  return {
    ...order,
    attachments
  }
}