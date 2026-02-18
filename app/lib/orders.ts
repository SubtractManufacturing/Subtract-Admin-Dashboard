import { db } from "./db/index.js"
import {
  orders,
  customers,
  vendors,
  orderLineItems,
  orderAttachments,
  attachments,
} from "./db/schema.js"
import { eq, desc, ne } from 'drizzle-orm'
import type { Customer, Vendor, OrderLineItem } from "./db/schema.js"
import { getNextOrderNumber, generateUniqueOrderNumber } from "./number-generator.js"
import { getOrderAttachments } from "./attachments.js"
import { createEvent } from "./events.js"
import { isFeatureEnabled, FEATURE_FLAGS } from "./featureFlags.js"
import { copyFile } from "./s3.server.js"

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

export async function restoreOrder(id: number, eventContext?: OrderEventContext): Promise<void> {
  try {
    const [order] = await db
      .update(orders)
      .set({ status: 'Pending' })
      .where(eq(orders.id, id))
      .returning()

    // Log event for order restoration
    await createEvent({
      entityType: "order",
      entityId: id.toString(),
      eventType: "order_restored",
      eventCategory: "system",
      title: `Order #${order.orderNumber} restored`,
      description: `Order has been restored from archive`,
      metadata: {
        orderNumber: order.orderNumber,
        previousStatus: 'Archived',
        newStatus: 'Pending'
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })
  } catch (error) {
    throw new Error(`Failed to restore order: ${error}`)
  }
}

export async function reassignOrderNumber(id: number, newOrderNumber: string, eventContext?: OrderEventContext): Promise<{ success: boolean; orderNumber?: string; error?: string }> {
  try {
    // Get the current order
    const currentOrder = await getOrder(id)
    if (!currentOrder) {
      return { success: false, error: 'Order not found' }
    }

    const previousOrderNumber = currentOrder.orderNumber

    // Check if the new order number already exists (on a different order)
    const existing = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNumber, newOrderNumber))
      .limit(1)

    if (existing.length > 0 && existing[0].id !== id) {
      return { success: false, error: 'Order number already exists' }
    }

    // Update the order number
    await db
      .update(orders)
      .set({ 
        orderNumber: newOrderNumber,
        updatedAt: new Date()
      })
      .where(eq(orders.id, id))

    // Log event for order number change
    await createEvent({
      entityType: "order",
      entityId: id.toString(),
      eventType: "order_number_changed",
      eventCategory: "system",
      title: `Order number changed from ${previousOrderNumber} to ${newOrderNumber}`,
      description: `Order number was reassigned`,
      metadata: {
        previousOrderNumber,
        newOrderNumber,
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })

    return { success: true, orderNumber: newOrderNumber }
  } catch (error) {
    console.error(`Failed to reassign order number: ${error}`)
    return { success: false, error: 'Failed to reassign order number' }
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

export async function duplicateOrder(
  orderId: number,
  eventContext?: OrderEventContext
): Promise<{
  success: boolean;
  orderId?: number;
  orderNumber?: string;
  error?: string;
}> {
  try {
    const order = await getOrder(orderId);
    if (!order) {
      return { success: false, error: "Order not found" };
    }

    // Fetch line items for the source order
    const sourceLineItems = await db
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, orderId));

    // Generate a unique order number before the transaction
    const newOrderNumber = await generateUniqueOrderNumber();
    const includeAttachments = await isFeatureEnabled(
      FEATURE_FLAGS.DUPLICATE_INCLUDE_ATTACHMENTS
    );

    const result = await db.transaction(async (tx) => {
      // Create the new order record
      const [newOrder] = await tx
        .insert(orders)
        .values({
          orderNumber: newOrderNumber,
          customerId: order.customerId,
          vendorId: order.vendorId,
          status: "Pending",
          totalPrice: order.totalPrice,
          vendorPay: order.vendorPay,
          leadTime: order.leadTime,
          // Reset/clear fields
          quoteId: null,
          sourceQuoteId: null,
          shipDate: null,
          notes: null,
        })
        .returning();

      // Duplicate order line items
      if (sourceLineItems.length > 0) {
        await tx.insert(orderLineItems).values(
          sourceLineItems.map((item) => ({
            orderId: newOrder.id,
            partId: item.partId,
            name: item.name,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            // Exclude notes
            notes: null,
          }))
        );
      }

      // Duplicate order-level attachments when feature flag is enabled
      if (includeAttachments) {
        const sourceOrderAttachments = await tx
          .select({
            attachment: attachments,
          })
          .from(orderAttachments)
          .innerJoin(
            attachments,
            eq(orderAttachments.attachmentId, attachments.id)
          )
          .where(eq(orderAttachments.orderId, orderId));

        for (const { attachment } of sourceOrderAttachments) {
          try {
            const sourceKey = attachment.s3Key;
            const fileName =
              sourceKey.split("/").pop() || attachment.fileName;
            const destKey = `orders/${newOrder.id}/attachments/${fileName}`;
            await copyFile(sourceKey, destKey);

            let newThumbnailS3Key: string | null = null;
            if (attachment.thumbnailS3Key) {
              const thumbSourceKey = attachment.thumbnailS3Key;
              const thumbFileName =
                thumbSourceKey.split("/").pop() || "thumbnail.png";
              const thumbDestKey = `orders/${newOrder.id}/attachments/${thumbFileName}`;
              await copyFile(thumbSourceKey, thumbDestKey);
              newThumbnailS3Key = thumbDestKey;
            }

            const [newAttachment] = await tx
              .insert(attachments)
              .values({
                s3Bucket: attachment.s3Bucket,
                s3Key: destKey,
                fileName: attachment.fileName,
                contentType: attachment.contentType,
                fileSize: attachment.fileSize,
                thumbnailS3Key: newThumbnailS3Key,
              })
              .returning();

            await tx.insert(orderAttachments).values({
              orderId: newOrder.id,
              attachmentId: newAttachment.id,
            });
          } catch (orderAttachmentCopyError) {
            console.warn(
              "Failed to copy order attachment:",
              orderAttachmentCopyError
            );
          }
        }
      }

      return { orderId: newOrder.id, orderNumber: newOrder.orderNumber };
    });

    // Log duplication event on source order
    await createEvent({
      entityType: "order",
      entityId: orderId.toString(),
      eventType: "order_duplicated",
      eventCategory: "system",
      title: "Order Duplicated",
      description: `Order ${order.orderNumber} was duplicated as ${result.orderNumber}`,
      metadata: {
        sourceOrderId: orderId,
        sourceOrderNumber: order.orderNumber,
        newOrderId: result.orderId,
        newOrderNumber: result.orderNumber,
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    });

    // Log creation event on new order
    await createEvent({
      entityType: "order",
      entityId: result.orderId.toString(),
      eventType: "order_created",
      eventCategory: "system",
      title: "Order Created (Duplicate)",
      description: `Duplicated from order ${order.orderNumber}`,
      metadata: {
        sourceOrderId: orderId,
        sourceOrderNumber: order.orderNumber,
        newOrderNumber: result.orderNumber,
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    });

    return {
      success: true,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
    };
  } catch (error) {
    console.error("Error duplicating order:", error);
    return { success: false, error: "Failed to duplicate order" };
  }
}