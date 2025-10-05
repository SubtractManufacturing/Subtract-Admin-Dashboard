import { db } from "./db/index.js"
import { orders, customers, vendors, orderLineItems } from "./db/schema.js"
import { eq, desc, ne } from 'drizzle-orm'
import type { Customer, Vendor, OrderLineItem } from "./db/schema.js"
import { getNextOrderNumber } from "./number-generator.js"
import { getOrderAttachments } from "./attachments.js"
import { createEvent } from "./events.js"

export type OrderWithRelations = {
  id: number
  orderNumber: string
  customerId: number | null
  vendorId: number | null
  quoteId: number | null
  status: 'Pending' | 'Waiting_For_Shop_Selection' | 'In_Production' | 'In_Inspection' | 'Shipped' | 'Delivered' | 'Completed' | 'Cancelled' | 'Archived'
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
  status?: 'Pending' | 'Waiting_For_Shop_Selection' | 'In_Production' | 'In_Inspection' | 'Shipped' | 'Delivered' | 'Completed' | 'Cancelled' | 'Archived'
  vendorPay?: string | null
  vendorPayPercentage?: number
  shipDate?: Date | null
}

export type OrderEventContext = {
  userId?: string
  userEmail?: string
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

export async function createOrder(orderData: OrderInput, eventContext?: OrderEventContext): Promise<OrderWithRelations> {
  try {
    // Use provided orderNumber or generate a new one
    const orderNumber = orderData.orderNumber || await getNextOrderNumber()

    // Remove orderNumber from orderData before inserting
    const orderDataWithoutOrderNumber = { ...orderData }
    delete orderDataWithoutOrderNumber.orderNumber
    delete orderDataWithoutOrderNumber.vendorPayPercentage // Remove if present for backwards compatibility

    // Calculate vendor pay as 70% of total price (default) or use provided amount
    // Since this is a new order with no line items yet, vendor pay starts at 0
    // It should be set manually or calculated when line items are added
    const vendorPay = orderData.vendorPay || "0"

    const insertResult = await db
      .insert(orders)
      .values({
        ...orderDataWithoutOrderNumber,
        orderNumber: orderNumber as string,
        vendorPay, // Store as dollar amount
        totalPrice: "0" // Initialize with 0, will be updated when line items are added
      })
      .returning()

    const newOrder = insertResult[0]

    // Log event for order creation
    await createEvent({
      entityType: "order",
      entityId: newOrder.id.toString(),
      eventType: "order_created",
      eventCategory: "system",
      title: `Order #${orderNumber} created`,
      description: `New order created with status: ${newOrder.status}`,
      metadata: {
        orderNumber,
        status: newOrder.status,
        customerId: newOrder.customerId,
        vendorId: newOrder.vendorId
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })

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

export async function updateOrder(id: number, orderData: Partial<OrderInput>, eventContext?: OrderEventContext): Promise<OrderWithRelations> {
  try {
    // Get the current order for comparison
    const currentOrder = await getOrder(id);
    if (!currentOrder) {
      throw new Error('Order not found');
    }

    // Filter out null values for orderNumber since it's required in the database
    const { orderNumber, vendorPayPercentage, ...restData } = orderData;

    // Convert vendorPayPercentage to vendorPay
    const vendorPay = vendorPayPercentage ? vendorPayPercentage.toString() : undefined;

    const updateData = {
      ...restData,
      ...(orderNumber !== undefined && orderNumber !== null && { orderNumber }),
      ...(vendorPay !== undefined && { vendorPay })
    };

    await db
      .update(orders)
      .set(updateData)
      .where(eq(orders.id, id))

    // Track all changes
    const changes: Record<string, string | number | null> = {};
    const changedFields: string[] = [];

    // Check each field for changes
    if (orderData.status && orderData.status !== currentOrder.status) {
      changes.previousStatus = currentOrder.status;
      changes.newStatus = orderData.status;
      changedFields.push('status');
    }
    if (orderData.vendorId !== undefined && orderData.vendorId !== currentOrder.vendorId) {
      changes.previousVendorId = currentOrder.vendorId;
      changes.newVendorId = orderData.vendorId;
      changedFields.push('vendor');
    }
    if (orderData.customerId !== undefined && orderData.customerId !== currentOrder.customerId) {
      changes.previousCustomerId = currentOrder.customerId;
      changes.newCustomerId = orderData.customerId;
      changedFields.push('customer');
    }
    if (orderData.shipDate !== undefined) {
      const newShipDate = orderData.shipDate ? new Date(orderData.shipDate).toISOString() : null;
      const currentShipDate = currentOrder.shipDate ? new Date(currentOrder.shipDate).toISOString() : null;
      if (newShipDate !== currentShipDate) {
        changes.previousShipDate = currentShipDate;
        changes.newShipDate = newShipDate;
        changedFields.push('shipDate');
      }
    }
    if ('totalPrice' in restData && restData.totalPrice !== currentOrder.totalPrice) {
      changes.previousTotalPrice = currentOrder.totalPrice;
      changes.newTotalPrice = restData.totalPrice as string | null;
      changedFields.push('totalPrice');
    }
    if (vendorPay !== undefined && vendorPay !== currentOrder.vendorPay) {
      changes.previousVendorPay = currentOrder.vendorPay;
      changes.newVendorPay = vendorPay;
      changedFields.push('vendorPay');
    }
    if ('leadTime' in restData && restData.leadTime !== currentOrder.leadTime) {
      changes.previousLeadTime = currentOrder.leadTime;
      changes.newLeadTime = restData.leadTime as number | null;
      changedFields.push('leadTime');
    }
    if ('notes' in restData && restData.notes !== currentOrder.notes) {
      changes.previousNotes = currentOrder.notes;
      changes.newNotes = restData.notes as string | null;
      changedFields.push('notes');
    }

    // Log specific status change event for better visibility
    if (orderData.status && orderData.status !== currentOrder.status) {
      await createEvent({
        entityType: "order",
        entityId: id.toString(),
        eventType: "status_change",
        eventCategory: "status",
        title: `Order status changed to ${orderData.status}`,
        description: `Status changed from ${currentOrder.status} to ${orderData.status}`,
        metadata: {
          orderNumber: currentOrder.orderNumber,
          previousStatus: currentOrder.status,
          newStatus: orderData.status
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail,
      })
    }

    // Log vendor assignment event for better visibility
    if (orderData.vendorId && orderData.vendorId !== currentOrder.vendorId) {
      await createEvent({
        entityType: "order",
        entityId: id.toString(),
        eventType: "vendor_assigned",
        eventCategory: "manufacturing",
        title: `Vendor assigned to order`,
        description: `Vendor ID ${orderData.vendorId} assigned to order #${currentOrder.orderNumber}`,
        metadata: {
          orderNumber: currentOrder.orderNumber,
          vendorId: orderData.vendorId,
          previousVendorId: currentOrder.vendorId
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail,
      })
    }

    // Log general update event if there were any changes
    if (changedFields.length > 0) {
      await createEvent({
        entityType: "order",
        entityId: id.toString(),
        eventType: "order_updated",
        eventCategory: "system",
        title: `Order #${currentOrder.orderNumber} updated`,
        description: `Updated fields: ${changedFields.join(', ')}`,
        metadata: {
          orderNumber: currentOrder.orderNumber,
          updatedFields: changedFields,
          changes: changes
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail,
      })
    }

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

export async function archiveOrder(id: number, eventContext?: OrderEventContext): Promise<void> {
  try {
    const [order] = await db
      .update(orders)
      .set({ status: 'Archived' })
      .where(eq(orders.id, id))
      .returning()

    // Log event for order archival
    await createEvent({
      entityType: "order",
      entityId: id.toString(),
      eventType: "order_archived",
      eventCategory: "system",
      title: `Order #${order.orderNumber} archived`,
      description: `Order has been archived`,
      metadata: {
        orderNumber: order.orderNumber
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })
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