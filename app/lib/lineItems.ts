import { db } from "./db/client";
import { orderLineItems, parts, type OrderLineItem, type NewOrderLineItem, type Part } from "./db/schema";
import { eq } from "drizzle-orm";

export type LineItemWithPart = {
  lineItem: OrderLineItem;
  part: Part | null;
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

export async function createLineItem(data: NewOrderLineItem): Promise<OrderLineItem> {
  const [lineItem] = await db.insert(orderLineItems).values(data).returning();
  return lineItem;
}

export async function updateLineItem(id: number, data: Partial<NewOrderLineItem>): Promise<OrderLineItem> {
  const [updated] = await db
    .update(orderLineItems)
    .set(data)
    .where(eq(orderLineItems.id, id))
    .returning();
  return updated;
}

export async function deleteLineItem(id: number): Promise<void> {
  await db.delete(orderLineItems).where(eq(orderLineItems.id, id));
}

export async function getLineItem(id: number): Promise<OrderLineItem | null> {
  const [lineItem] = await db
    .select()
    .from(orderLineItems)
    .where(eq(orderLineItems.id, id));
  return lineItem || null;
}