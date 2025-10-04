import { db } from "./db/client";
import {
  orderLineItems,
  parts,
  orders,
  type OrderLineItem,
  type NewOrderLineItem,
  type Part,
} from "./db/schema";
import { eq } from "drizzle-orm";
import { createEvent } from "./events";

export type LineItemWithPart = {
  lineItem: OrderLineItem;
  part: Part | null;
};

export type LineItemEventContext = {
  userId?: string;
  userEmail?: string;
};

export async function getLineItemsByOrderId(
  orderId: number
): Promise<LineItemWithPart[]> {
  return await db
    .select({
      lineItem: orderLineItems,
      part: parts,
    })
    .from(orderLineItems)
    .leftJoin(parts, eq(orderLineItems.partId, parts.id))
    .where(eq(orderLineItems.orderId, orderId));
}

// Helper function to recalculate and update order total
async function updateOrderTotal(orderId: number): Promise<number> {
  const lineItems = await db
    .select()
    .from(orderLineItems)
    .where(eq(orderLineItems.orderId, orderId));

  const total = lineItems.reduce((sum, item) => {
    const itemTotal = parseFloat(item.unitPrice || "0") * (item.quantity || 0);
    return sum + itemTotal;
  }, 0);

  // Update the order's totalPrice
  await db
    .update(orders)
    .set({
      totalPrice: total.toFixed(2),
      updatedAt: new Date()
    })
    .where(eq(orders.id, orderId));

  return total;
}

export async function createLineItem(
  data: NewOrderLineItem,
  eventContext?: LineItemEventContext
): Promise<OrderLineItem> {
  const [lineItem] = await db.insert(orderLineItems).values(data).returning();

  // Update the order's totalPrice
  const newTotal = await updateOrderTotal(data.orderId);

  // Log event
  await createEvent({
    entityType: "order",
    entityId: data.orderId.toString(),
    eventType: "line_item_added",
    eventCategory: "system",
    title: "Line Item Added",
    description: `Added line item for part ${data.partId || "(no part)"}`,
    metadata: {
      lineItemId: lineItem.id,
      partId: data.partId,
      quantity: data.quantity,
      unitPrice: data.unitPrice,
      newOrderTotal: newTotal.toFixed(2),
    },
    userId: eventContext?.userId,
    userEmail: eventContext?.userEmail,
  });

  return lineItem;
}

export async function updateLineItem(
  id: number,
  data: Partial<NewOrderLineItem>,
  eventContext?: LineItemEventContext
): Promise<OrderLineItem> {
  // Get the current line item before updating
  const currentLineItem = await getLineItem(id);
  if (!currentLineItem) {
    throw new Error(`Line item ${id} not found`);
  }

  // Calculate the old order total before the update
  const allLineItems = await db
    .select()
    .from(orderLineItems)
    .where(eq(orderLineItems.orderId, currentLineItem.orderId));

  const oldOrderTotal = allLineItems.reduce((sum, item) => {
    const itemTotal = parseFloat(item.unitPrice || "0") * (item.quantity || 0);
    return sum + itemTotal;
  }, 0);

  const [updated] = await db
    .update(orderLineItems)
    .set(data)
    .where(eq(orderLineItems.id, id))
    .returning();

  // Update the order's totalPrice and get the new total
  const newOrderTotal = await updateOrderTotal(updated.orderId);

  // Create separate events for each field that changed
  const eventPromises: Promise<unknown>[] = [];

  // Price change event
  if (
    data.unitPrice !== undefined &&
    data.unitPrice !== currentLineItem.unitPrice
  ) {
    eventPromises.push(
      createEvent({
        entityType: "order",
        entityId: updated.orderId.toString(),
        eventType: "line_item_updated",
        eventCategory: "system",
        title: "Price Updated",
        description: `From $${oldOrderTotal.toFixed(
          2
        )} to $${newOrderTotal.toFixed(2)}`,
        metadata: {
          lineItemId: id,
          lineItemName: updated.name,
          fieldChanged: "unitPrice",
          lineItem: {
            previousUnitPrice: currentLineItem.unitPrice,
            newUnitPrice: data.unitPrice,
            quantity: updated.quantity,
          },
          orderTotals: {
            previousOrderTotal: oldOrderTotal.toFixed(2),
            newOrderTotal: newOrderTotal.toFixed(2),
          },
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail,
      })
    );
  }

  // Quantity change event
  if (
    data.quantity !== undefined &&
    data.quantity !== currentLineItem.quantity
  ) {
    eventPromises.push(
      createEvent({
        entityType: "order",
        entityId: updated.orderId.toString(),
        eventType: "line_item_updated",
        eventCategory: "system",
        title: "Quantity Updated",
        description: `From $${oldOrderTotal.toFixed(
          2
        )} to $${newOrderTotal.toFixed(2)}`,
        metadata: {
          lineItemId: id,
          lineItemName: updated.name,
          fieldChanged: "quantity",
          lineItem: {
            previousQuantity: currentLineItem.quantity,
            newQuantity: data.quantity,
            unitPrice: updated.unitPrice,
          },
          orderTotals: {
            previousOrderTotal: oldOrderTotal.toFixed(2),
            newOrderTotal: newOrderTotal.toFixed(2),
          },
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail,
      })
    );
  }

  // Name change event
  if (data.name !== undefined && data.name !== currentLineItem.name) {
    eventPromises.push(
      createEvent({
        entityType: "order",
        entityId: updated.orderId.toString(),
        eventType: "line_item_updated",
        eventCategory: "system",
        title: "Line Item Name Updated",
        description: `Name changed from "${currentLineItem.name}" to "${data.name}"`,
        metadata: {
          lineItemId: id,
          lineItemName: updated.name,
          fieldChanged: "name",
          previousValue: currentLineItem.name,
          newValue: data.name,
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail,
      })
    );
  }

  // Description change event
  if (
    data.description !== undefined &&
    data.description !== currentLineItem.description
  ) {
    eventPromises.push(
      createEvent({
        entityType: "order",
        entityId: updated.orderId.toString(),
        eventType: "line_item_updated",
        eventCategory: "system",
        title: "Line Item Description Updated",
        description: `Description updated for ${updated.name}`,
        metadata: {
          lineItemId: id,
          lineItemName: updated.name,
          fieldChanged: "description",
          previousValue: currentLineItem.description,
          newValue: data.description,
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail,
      })
    );
  }

  // Part ID change event
  if (data.partId !== undefined && data.partId !== currentLineItem.partId) {
    eventPromises.push(
      createEvent({
        entityType: "order",
        entityId: updated.orderId.toString(),
        eventType: "line_item_updated",
        eventCategory: "system",
        title: "Line Item Part Updated",
        description: `Part association changed for ${updated.name}`,
        metadata: {
          lineItemId: id,
          lineItemName: updated.name,
          fieldChanged: "partId",
          previousValue: currentLineItem.partId,
          newValue: data.partId,
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail,
      })
    );
  }

  // Notes change event
  if (data.notes !== undefined && data.notes !== currentLineItem.notes) {
    eventPromises.push(
      createEvent({
        entityType: "order",
        entityId: updated.orderId.toString(),
        eventType: "line_item_updated",
        eventCategory: "system",
        title: "Line Item Notes Updated",
        description: `Notes updated for ${updated.name}`,
        metadata: {
          lineItemId: id,
          lineItemName: updated.name,
          fieldChanged: "notes",
          previousValue: currentLineItem.notes,
          newValue: data.notes,
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail,
      })
    );
  }

  // Execute all event creations
  await Promise.all(eventPromises);

  return updated;
}

export async function deleteLineItem(
  id: number,
  eventContext?: LineItemEventContext
): Promise<void> {
  // Get line item details before deletion for logging
  const lineItem = await getLineItem(id);

  if (!lineItem) {
    return; // Line item doesn't exist, nothing to delete
  }

  // Delete the line item
  await db.delete(orderLineItems).where(eq(orderLineItems.id, id));

  // Update the order's totalPrice
  const newTotal = await updateOrderTotal(lineItem.orderId);

  // Log event
  await createEvent({
    entityType: "order",
    entityId: lineItem.orderId.toString(),
    eventType: "line_item_deleted",
    eventCategory: "system",
    title: "Line Item Deleted",
    description: `Deleted line item ${id}`,
    metadata: {
      lineItemId: id,
      partId: lineItem.partId,
      quantity: lineItem.quantity,
      unitPrice: lineItem.unitPrice,
      newOrderTotal: newTotal.toFixed(2),
    },
    userId: eventContext?.userId,
    userEmail: eventContext?.userEmail,
  });
}

export async function getLineItem(id: number): Promise<OrderLineItem | null> {
  const [lineItem] = await db
    .select()
    .from(orderLineItems)
    .where(eq(orderLineItems.id, id));
  return lineItem || null;
}
