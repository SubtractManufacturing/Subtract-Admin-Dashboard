import { db } from "./db/index.js"
import { orders, quotes, customers, vendors, orderLineItems, quoteLineItems } from "./db/schema.js"
import { eq, count, sum, gte, inArray, and, ne, sql, lte, between, isNotNull } from 'drizzle-orm'

export type TimeRangeValue = "7d" | "14d" | "30d" | "90d" | "all";

export type DashboardStats = {
  actionItems: number
  openPoRevenue: number
  openPOs: number
  rfqs: number
}

export type OrderStatusCounts = {
  Pending: number
  Waiting_For_Shop_Selection: number
  In_Production: number
  In_Inspection: number
  Shipped: number
  Delivered: number
  Completed: number
  Cancelled: number
}

export type QuoteStatusCounts = {
  RFQ: number
  Draft: number
  Sent: number
  Accepted: number
  Rejected: number
  Dropped: number
  Expired: number
}

export type FinancialSummary = {
  openPoRevenue: number
  pipelineValue: number
  attentionCount: number
}

export type DashboardData = {
  stats: DashboardStats
  orderStatusCounts: OrderStatusCounts
  quoteStatusCounts: QuoteStatusCounts
  financials: FinancialSummary
}

// Helper to get start date from time range
function getStartDateFromRange(range: TimeRangeValue): Date | null {
  if (range === "all") return null;
  
  const now = new Date();
  const daysMap: Record<Exclude<TimeRangeValue, "all">, number> = {
    "7d": 7,
    "14d": 14,
    "30d": 30,
    "90d": 90,
  };
  
  now.setDate(now.getDate() - daysMap[range as Exclude<TimeRangeValue, "all">]);
  return now;
}

// Order status priority for sorting (lower = higher priority)
const ORDER_STATUS_PRIORITY: Record<string, number> = {
  'Pending': 1,
  'Waiting_For_Shop_Selection': 2,
  'In_Production': 3,
  'In_Inspection': 4,
  'Shipped': 5,
  'Delivered': 6,
  'Completed': 7,
  'Cancelled': 8,
  'Archived': 9,
};

// Quote status priority for sorting (lower = higher priority)
const QUOTE_STATUS_PRIORITY: Record<string, number> = {
  'RFQ': 1,
  'Sent': 2,
  'Draft': 3,
  'Accepted': 4,
  'Rejected': 5,
  'Dropped': 6,
  'Expired': 7,
};

export type Order = {
  id: number
  order_number: string
  customer_id: number | null
  customer_name: string
  vendor_id: number | null
  vendor_name: string
  status: 'Pending' | 'Waiting_For_Shop_Selection' | 'In_Production' | 'In_Inspection' | 'Shipped' | 'Delivered' | 'Completed' | 'Cancelled' | 'Archived'
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

export async function getDashboardStats(range: TimeRangeValue = "30d"): Promise<DashboardStats> {
  try {
    const startDate = getStartDateFromRange(range);
    
    // Get action items (orders pending review) - not time-filtered
    const actionItemsResult = await db
      .select({ count: count() })
      .from(orders)
      .where(eq(orders.status, 'Pending'))

    // Get open PO revenue and count - not time-filtered
    const openOrdersResult = await db
      .select({
        count: count(),
        totalRevenue: sum(orders.totalPrice)
      })
      .from(orders)
      .where(inArray(orders.status, ['Pending', 'Waiting_For_Shop_Selection', 'In_Production', 'In_Inspection', 'Shipped']))

    // Get RFQs (quotes created in selected time range)
    const rfqWhereConditions = [eq(quotes.isArchived, false)];
    if (startDate) {
      rfqWhereConditions.push(gte(quotes.createdAt, startDate));
    }
    
    const rfqResult = await db
      .select({ count: count() })
      .from(quotes)
      .where(and(...rfqWhereConditions))

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

export async function getOrderStatusCounts(): Promise<OrderStatusCounts> {
  try {
    const result = await db
      .select({
        status: orders.status,
        count: count(),
      })
      .from(orders)
      .where(ne(orders.status, 'Archived'))
      .groupBy(orders.status);

    const counts: OrderStatusCounts = {
      Pending: 0,
      Waiting_For_Shop_Selection: 0,
      In_Production: 0,
      In_Inspection: 0,
      Shipped: 0,
      Delivered: 0,
      Completed: 0,
      Cancelled: 0,
    };

    result.forEach(row => {
      if (row.status in counts) {
        counts[row.status as keyof OrderStatusCounts] = row.count;
      }
    });

    return counts;
  } catch (error) {
    console.error('Error fetching order status counts:', error);
    return {
      Pending: 0,
      Waiting_For_Shop_Selection: 0,
      In_Production: 0,
      In_Inspection: 0,
      Shipped: 0,
      Delivered: 0,
      Completed: 0,
      Cancelled: 0,
    };
  }
}

export async function getQuoteStatusCounts(): Promise<QuoteStatusCounts> {
  try {
    const result = await db
      .select({
        status: quotes.status,
        count: count(),
      })
      .from(quotes)
      .where(eq(quotes.isArchived, false))
      .groupBy(quotes.status);

    const counts: QuoteStatusCounts = {
      RFQ: 0,
      Draft: 0,
      Sent: 0,
      Accepted: 0,
      Rejected: 0,
      Dropped: 0,
      Expired: 0,
    };

    result.forEach(row => {
      if (row.status in counts) {
        counts[row.status as keyof QuoteStatusCounts] = row.count;
      }
    });

    return counts;
  } catch (error) {
    console.error('Error fetching quote status counts:', error);
    return {
      RFQ: 0,
      Draft: 0,
      Sent: 0,
      Accepted: 0,
      Rejected: 0,
      Dropped: 0,
      Expired: 0,
    };
  }
}

export async function getFinancialSummary(): Promise<FinancialSummary> {
  try {
    // Open PO Revenue (orders in active statuses)
    const openOrdersResult = await db
      .select({
        totalRevenue: sum(orders.totalPrice)
      })
      .from(orders)
      .where(inArray(orders.status, ['Pending', 'Waiting_For_Shop_Selection', 'In_Production', 'In_Inspection', 'Shipped']));

    // Pipeline Value (active quotes: RFQ, Draft, Sent)
    const pipelineResult = await db
      .select({
        totalValue: sum(quotes.total)
      })
      .from(quotes)
      .where(and(
        inArray(quotes.status, ['RFQ', 'Draft', 'Sent']),
        eq(quotes.isArchived, false)
      ));

    // Attention count (orders needing attention: Pending + Waiting_For_Shop_Selection)
    const attentionResult = await db
      .select({ count: count() })
      .from(orders)
      .where(inArray(orders.status, ['Pending', 'Waiting_For_Shop_Selection']));

    return {
      openPoRevenue: Number(openOrdersResult[0]?.totalRevenue || 0),
      pipelineValue: Number(pipelineResult[0]?.totalValue || 0),
      attentionCount: attentionResult[0]?.count || 0,
    };
  } catch (error) {
    console.error('Error fetching financial summary:', error);
    return {
      openPoRevenue: 0,
      pipelineValue: 0,
      attentionCount: 0,
    };
  }
}

export async function getOrders(limit: number = 10): Promise<Order[]> {
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
        vendor_name: vendors.displayName,
        line_item_count: sql<number>`COALESCE(COUNT(DISTINCT ${orderLineItems.id}), 0)`
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(vendors, eq(orders.vendorId, vendors.id))
      .leftJoin(orderLineItems, eq(orders.id, orderLineItems.orderId))
      .where(ne(orders.status, 'Archived'))
      .groupBy(orders.id, customers.displayName, vendors.displayName)

    // Sort by priority in JavaScript since Drizzle doesn't support custom ordering
    const sorted = result.sort((a, b) => {
      const priorityA = ORDER_STATUS_PRIORITY[a.status] || 99;
      const priorityB = ORDER_STATUS_PRIORITY[b.status] || 99;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      // Secondary sort by created_at (newest first within same status)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return sorted.slice(0, limit).map(order => ({
      id: order.id,
      order_number: order.order_number,
      customer_id: order.customer_id,
      customer_name: order.customer_name || 'Unknown',
      vendor_id: order.vendor_id,
      vendor_name: order.vendor_name || 'Unassigned',
      status: order.status,
      quantity: Number(order.line_item_count) || 0,
      po_amount: order.total_price,
      ship_date: order.ship_date,
      created_at: order.created_at
    }))
  } catch (error) {
    console.error('Error fetching orders:', error)
    return []
  }
}

export async function getQuotes(limit: number = 10): Promise<Quote[]> {
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
        vendor_name: vendors.displayName,
        line_item_count: sql<number>`COALESCE(COUNT(DISTINCT ${quoteLineItems.id}), 0)`
      })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .leftJoin(vendors, eq(quotes.vendorId, vendors.id))
      .leftJoin(quoteLineItems, eq(quotes.id, quoteLineItems.quoteId))
      .where(and(
        inArray(quotes.status, ['RFQ', 'Draft', 'Sent', 'Accepted', 'Rejected', 'Dropped', 'Expired']),
        eq(quotes.isArchived, false)
      ))
      .groupBy(quotes.id, customers.displayName, vendors.displayName)

    // Sort by priority in JavaScript
    const sorted = result.sort((a, b) => {
      const priorityA = QUOTE_STATUS_PRIORITY[a.status] || 99;
      const priorityB = QUOTE_STATUS_PRIORITY[b.status] || 99;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      // Secondary sort by created_at (newest first within same status)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return sorted.slice(0, limit).map(quote => ({
      id: quote.id,
      quote_number: quote.quote_number,
      customer_id: quote.customer_id,
      customer_name: quote.customer_name || 'Unknown',
      vendor_id: quote.vendor_id,
      vendor_name: quote.vendor_name || 'Unassigned',
      status: quote.status,
      quantity: Number(quote.line_item_count) || 0,
      total_price: quote.total_price,
      valid_until: quote.valid_until,
      created_at: quote.created_at
    }))
  } catch (error) {
    console.error('Error fetching quotes:', error)
    return []
  }
}