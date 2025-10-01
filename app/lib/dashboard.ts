import { db } from "./db/index.js"
import { orders, quotes, customers, vendors } from "./db/schema.js"
import { eq, count, sum, gte, inArray, and, ne } from 'drizzle-orm'

export type DashboardStats = {
  actionItems: number
  openPoRevenue: number
  openPOs: number
  rfqs: number
}

export type Order = {
  id: number
  order_number: string
  customer_id: number | null
  customer_name: string
  vendor_id: number | null
  vendor_name: string
  status: 'Pending' | 'In_Production' | 'Completed' | 'Cancelled' | 'Archived'
  quantity: number
  po_amount: string | null
  ship_date: Date | string | null
  created_at: Date | string
}

export type Quote = {
  id: number
  quote_number: string
  customer_id: number | null
  customer_name: string
  vendor_id: number | null
  vendor_name: string
  status: 'RFQ' | 'Draft' | 'Sent' | 'Accepted' | 'Rejected' | 'Dropped' | 'Expired'
  quantity: number
  total_price: string | null
  valid_until: Date | string | null
  created_at: Date | string
}

export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    // Get action items (orders pending review)
    const actionItemsResult = await db
      .select({ count: count() })
      .from(orders)
      .where(eq(orders.status, 'Pending'))

    // Get open PO revenue and count
    const openOrdersResult = await db
      .select({
        count: count(),
        totalRevenue: sum(orders.totalPrice)
      })
      .from(orders)
      .where(inArray(orders.status, ['Pending', 'In_Production']))

    // Get RFQs (quotes sent in last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    
    const rfqResult = await db
      .select({ count: count() })
      .from(quotes)
      .where(and(
        eq(quotes.status, 'Sent'),
        gte(quotes.createdAt, thirtyDaysAgo)
      ))

    return {
      actionItems: actionItemsResult[0]?.count || 0,
      openPoRevenue: Number(openOrdersResult[0]?.totalRevenue || 0),
      openPOs: openOrdersResult[0]?.count || 0,
      rfqs: rfqResult[0]?.count || 0
    }
  } catch (error) {
    console.error('Error fetching dashboard stats:', error)
    return {
      actionItems: 0,
      openPoRevenue: 0,
      openPOs: 0,
      rfqs: 0
    }
  }
}

export async function getOrders(): Promise<Order[]> {
  try {
    const result = await db
      .select({
        id: orders.id,
        order_number: orders.orderNumber,
        customer_id: orders.customerId,
        vendor_id: orders.vendorId,
        status: orders.status,
        total_price: orders.totalPrice,
        ship_date: orders.shipDate,
        created_at: orders.createdAt,
        customer_name: customers.displayName,
        vendor_name: vendors.displayName
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(vendors, eq(orders.vendorId, vendors.id))
      .where(ne(orders.status, 'Archived'))
      .orderBy(orders.createdAt)
      .limit(10)

    return result.map(order => ({
      id: order.id,
      order_number: order.order_number,
      customer_id: order.customer_id,
      customer_name: order.customer_name || 'Unknown',
      vendor_id: order.vendor_id,
      vendor_name: order.vendor_name || 'Unknown',
      status: order.status,
      quantity: 0, // This would need to be calculated from order_line_items
      po_amount: order.total_price,
      ship_date: order.ship_date,
      created_at: order.created_at
    }))
  } catch (error) {
    console.error('Error fetching orders:', error)
    return []
  }
}

export async function getQuotes(): Promise<Quote[]> {
  try {
    const result = await db
      .select({
        id: quotes.id,
        quote_number: quotes.quoteNumber,
        customer_id: quotes.customerId,
        vendor_id: quotes.vendorId,
        status: quotes.status,
        total_price: quotes.total,
        valid_until: quotes.validUntil,
        created_at: quotes.createdAt,
        customer_name: customers.displayName,
        vendor_name: vendors.displayName
      })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .leftJoin(vendors, eq(quotes.vendorId, vendors.id))
      .orderBy(quotes.createdAt)
      .limit(10)

    return result.map(quote => ({
      id: quote.id,
      quote_number: quote.quote_number,
      customer_id: quote.customer_id,
      customer_name: quote.customer_name || 'Unknown',
      vendor_id: quote.vendor_id,
      vendor_name: quote.vendor_name || 'Unknown',
      status: quote.status,
      quantity: 0, // This would need to be calculated from quote_line_items
      total_price: quote.total_price,
      valid_until: quote.valid_until,
      created_at: quote.created_at
    }))
  } catch (error) {
    console.error('Error fetching quotes:', error)
    return []
  }
}