import { db } from "./db/client";
import { orderLineItems, parts, type OrderLineItem, type NewOrderLineItem, type Part } from "./db/schema";
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

export async function getLineItemsByOrderId(orderId: number): Promise<LineItemWithPart[]> {
  return await db
    .select({
      lineItem: orderLineItems,
      part: parts
    })
    .from(orderLineItems)
    .leftJoin(parts, eq(orderLineItems.partId, parts.id))
    .where(eq(orderLineItems.orderId, orderId));
}

export async function createLineItem(data: NewOrderLineItem, eventContext?: LineItemEventContext): Promise<OrderLineItem> {
  const [lineItem] = await db.insert(orderLineItems).values(data).returning();

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
      unitPrice: data.unitPrice
    },
    userId: eventContext?.userId,
    userEmail: eventContext?.userEmail
  });

  return lineItem;
}

export async function updateLineItem(id: number, data: Partial<NewOrderLineItem>, eventContext?: LineItemEventContext): Promise<OrderLineItem> {
  const [updated] = await db
    .update(orderLineItems)
    .set(data)
    .where(eq(orderLineItems.id, id))
    .returning();

  // Log event
  await createEvent({
    entityType: "order",
    entityId: updated.orderId.toString(),
    eventType: "line_item_updated",
    eventCategory: "system",
    title: "Line Item Updated",
    description: `Updated line item ${id}`,
    metadata: {
      lineItemId: id,
      updatedFields: Object.keys(data),
      ...data
    },
    userId: eventContext?.userId,
    userEmail: eventContext?.userEmail
  });

  return updated;
}

export async function deleteLineItem(id: number, eventContext?: LineItemEventContext): Promise<void> {
  // Get line item details before deletion for logging
  const lineItem = await getLineItem(id);

  await db.delete(orderLineItems).where(eq(orderLineItems.id, id));

  // Log event if line item existed
  if (lineItem) {
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
        unitPrice: lineItem.unitPrice
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail
    });
  }
}

export async function getLineItem(id: number): Promise<OrderLineItem | null> {
  const [lineItem] = await db
    .select()
    .from(orderLineItems)
    .where(eq(orderLineItems.id, id));
  return lineItem || null;
}