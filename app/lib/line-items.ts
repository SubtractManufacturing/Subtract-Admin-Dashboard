import { db } from "./db/index.js"
import { orderLineItems, quoteLineItems, parts } from "./db/schema.js"
import { eq, desc } from 'drizzle-orm'
import type { OrderLineItem, NewOrderLineItem, QuoteLineItem, NewQuoteLineItem, Part } from "./db/schema.js"

export type OrderLineItemWithPart = OrderLineItem & {
  part?: Part | null
}

export type QuoteLineItemWithPart = QuoteLineItem & {
  part?: Part | null
}

export type LineItemInput = {
  partId?: string | null
  name?: string | null
  description?: string | null
  quantity: number
  unitPrice: string
  notes?: string | null
}

// Order Line Items
export async function getOrderLineItems(orderId: number): Promise<OrderLineItemWithPart[]> {
  try {
    const result = await db
      .select({
        id: orderLineItems.id,
        orderId: orderLineItems.orderId,
        partId: orderLineItems.partId,
        name: orderLineItems.name,
        description: orderLineItems.description,
        quantity: orderLineItems.quantity,
        unitPrice: orderLineItems.unitPrice,
        notes: orderLineItems.notes,
        part: parts
      })
      .from(orderLineItems)
      .leftJoin(parts, eq(orderLineItems.partId, parts.id))
      .where(eq(orderLineItems.orderId, orderId))
      .orderBy(orderLineItems.id)

    return result
  } catch (error) {
    console.error('Error fetching order line items:', error)
    return []
  }
}

export async function createOrderLineItem(orderId: number, lineItemData: LineItemInput): Promise<OrderLineItem> {
  try {
    const result = await db
      .insert(orderLineItems)
      .values({
        orderId,
        ...lineItemData
      })
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to create order line item: ${error}`)
  }
}

export async function updateOrderLineItem(id: number, lineItemData: Partial<LineItemInput>): Promise<OrderLineItem> {
  try {
    const result = await db
      .update(orderLineItems)
      .set(lineItemData)
      .where(eq(orderLineItems.id, id))
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to update order line item: ${error}`)
  }
}

export async function deleteOrderLineItem(id: number): Promise<void> {
  try {
    await db
      .delete(orderLineItems)
      .where(eq(orderLineItems.id, id))
  } catch (error) {
    throw new Error(`Failed to delete order line item: ${error}`)
  }
}

// Quote Line Items
export async function getQuoteLineItems(quoteId: number): Promise<QuoteLineItemWithPart[]> {
  try {
    const result = await db
      .select({
        id: quoteLineItems.id,
        quoteId: quoteLineItems.quoteId,
        partId: quoteLineItems.partId,
        name: quoteLineItems.name,
        description: quoteLineItems.description,
        quantity: quoteLineItems.quantity,
        unitPrice: quoteLineItems.unitPrice,
        notes: quoteLineItems.notes,
        part: parts
      })
      .from(quoteLineItems)
      .leftJoin(parts, eq(quoteLineItems.partId, parts.id))
      .where(eq(quoteLineItems.quoteId, quoteId))
      .orderBy(quoteLineItems.id)

    return result
  } catch (error) {
    console.error('Error fetching quote line items:', error)
    return []
  }
}

export async function createQuoteLineItem(quoteId: number, lineItemData: LineItemInput): Promise<QuoteLineItem> {
  try {
    const result = await db
      .insert(quoteLineItems)
      .values({
        quoteId,
        ...lineItemData
      })
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to create quote line item: ${error}`)
  }
}

export async function updateQuoteLineItem(id: number, lineItemData: Partial<LineItemInput>): Promise<QuoteLineItem> {
  try {
    const result = await db
      .update(quoteLineItems)
      .set(lineItemData)
      .where(eq(quoteLineItems.id, id))
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to update quote line item: ${error}`)
  }
}

export async function deleteQuoteLineItem(id: number): Promise<void> {
  try {
    await db
      .delete(quoteLineItems)
      .where(eq(quoteLineItems.id, id))
  } catch (error) {
    throw new Error(`Failed to delete quote line item: ${error}`)
  }
}

// Helper function to calculate totals
export function calculateLineItemTotal(lineItem: OrderLineItemWithPart | QuoteLineItemWithPart): number {
  return lineItem.quantity * parseFloat(lineItem.unitPrice)
}

export function calculateOrderTotal(lineItems: OrderLineItemWithPart[]): number {
  return lineItems.reduce((total, item) => total + calculateLineItemTotal(item), 0)
}

export function calculateQuoteTotal(lineItems: QuoteLineItemWithPart[]): number {
  return lineItems.reduce((total, item) => total + calculateLineItemTotal(item), 0)
}