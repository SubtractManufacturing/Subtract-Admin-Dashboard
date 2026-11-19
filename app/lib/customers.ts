/**
 * Customers: Organizations with a customer account (ADR-0013). Ids are
 * customer account uuids. Reads return the flat {@link Customer} record;
 * writes accept the flat {@link CustomerInput} and are split across the
 * Organization, its primary Contact, the account and its addresses.
 */
import { and, desc, eq, max } from "drizzle-orm"

import { db } from "./db/index.js"
import { orders, quotes } from "./db/schema.js"
import { getOrganizationAttachments } from "./attachments.js"
import { createEvent } from "./events.js"
import type { CustomerSortBy } from "./customer-sort.js"
import {
  archiveAccount,
  createAccount,
  loadAccountRecord,
  loadAccountRecordMap,
  loadAccountRecords,
  updateAccountProfile,
  type Executor,
} from "./organizations/accounts.server.js"
import type {
  AccountProfileInput,
  Customer,
  Vendor,
} from "./organizations/types.js"

export type { Customer }

export type CustomerInput = AccountProfileInput

export type CustomerEventContext = {
  userId?: string
  userEmail?: string
  /** When set, logs a dedicated checkout-import event instead of generic customer_updated */
  checkoutAddressImport?: {
    quoteId: number
    orderId?: number
    quoteNumber?: string
  }
}

export type CustomerQuote = {
  id: number
  quoteNumber: string
  customerAccountId: string | null
  vendorAccountId: string | null
  status: string
  total: string | null
  validUntil: Date | null
  createdAt: Date
  convertedToOrderId: number | null
  vendor: Vendor | null
}

function toCustomer(record: Vendor): Customer {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { discordId, address, notes, ...customer } = record
  return customer
}

function sortCustomersByLatestActivity(
  customerRows: Customer[],
  activityRows: Array<{ accountId: string | null; latestAt: Date | null }>
): Customer[] {
  const latestByAccountId = new Map<string, number>()

  for (const activity of activityRows) {
    if (activity.accountId && activity.latestAt) {
      latestByAccountId.set(activity.accountId, activity.latestAt.getTime())
    }
  }

  return [...customerRows].sort((a, b) => {
    const aLatest = latestByAccountId.get(a.id)
    const bLatest = latestByAccountId.get(b.id)

    if (aLatest === undefined && bLatest === undefined) {
      return b.createdAt.getTime() - a.createdAt.getTime()
    }

    if (aLatest === undefined) return 1
    if (bLatest === undefined) return -1

    const activityDelta = bLatest - aLatest
    if (activityDelta !== 0) {
      return activityDelta
    }

    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}

/** Active Customers. */
export async function getCustomers(options: { sortBy?: CustomerSortBy } = {}): Promise<Customer[]> {
  try {
    const rows = (await loadAccountRecords("customer", { activeOnly: true })).map(toCustomer)

    if (options.sortBy === "name") {
      return rows.sort((a, b) => a.displayName.localeCompare(b.displayName))
    }

    if (options.sortBy === "recentOrders") {
      const latestOrders = await db
        .select({ accountId: orders.customerAccountId, latestAt: max(orders.createdAt) })
        .from(orders)
        .groupBy(orders.customerAccountId)
      return sortCustomersByLatestActivity(rows, latestOrders)
    }

    if (options.sortBy === "recentQuotes") {
      const latestQuotes = await db
        .select({ accountId: quotes.customerAccountId, latestAt: max(quotes.createdAt) })
        .from(quotes)
        .where(eq(quotes.isArchived, false))
        .groupBy(quotes.customerAccountId)
      return sortCustomersByLatestActivity(rows, latestQuotes)
    }

    return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  } catch (error) {
    console.error('Error fetching customers:', error)
    return []
  }
}

/** A Customer by account id, archived or not. Null for unknown or non-uuid ids. */
export async function getCustomer(id: string, executor?: Executor): Promise<Customer | null> {
  try {
    const record = await loadAccountRecord("customer", id, executor)
    return record ? toCustomer(record) : null
  } catch (error) {
    throw new Error(`Failed to get customer: ${error}`)
  }
}

export async function getCustomersByIds(ids: string[]): Promise<Customer[]> {
  if (ids.length === 0) return []
  try {
    return (await loadAccountRecords("customer", { ids })).map(toCustomer)
  } catch (error) {
    console.error("Error fetching customers by IDs:", error)
    return []
  }
}

/** Customers keyed by account id; used to attach Customers to Quote and Order rows. */
export async function getCustomerMap(
  ids: Array<string | null | undefined>,
  executor?: Executor,
): Promise<Map<string, Customer>> {
  const records = await loadAccountRecordMap("customer", ids, executor)
  return new Map([...records].map(([id, record]) => [id, toCustomer(record)]))
}

export async function createCustomer(
  customerData: CustomerInput,
  eventContext?: CustomerEventContext,
  options: { organizationId?: string } = {},
): Promise<Customer> {
  try {
    const customer = toCustomer(
      await createAccount("customer", customerData, { organizationId: options.organizationId }),
    )

    await createEvent({
      entityType: "customer",
      entityId: customer.id,
      eventType: "customer_created",
      eventCategory: "system",
      title: `Customer "${customer.displayName}" created`,
      description: `New customer added to the system`,
      metadata: {
        displayName: customer.displayName,
        organizationId: customer.organizationId,
        email: customer.email,
        phone: customer.phone
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })

    return customer
  } catch (error) {
    throw new Error(`Failed to create customer: ${error instanceof Error ? error.message : error}`)
  }
}

export async function updateCustomer(id: string, customerData: Partial<CustomerInput>, eventContext?: CustomerEventContext): Promise<Customer> {
  try {
    const customer = toCustomer(await updateAccountProfile("customer", id, customerData))

    if (eventContext?.checkoutAddressImport) {
      await createEvent({
        entityType: "customer",
        entityId: id,
        eventType: "customer_checkout_addresses_imported",
        eventCategory: "system",
        title: "Addresses imported from checkout",
        description: `Billing/shipping or phone were imported from the quote payment checkout.`,
        metadata: {
          ...eventContext.checkoutAddressImport,
          updatedFields: Object.keys(customerData),
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail,
      })
    } else {
      await createEvent({
        entityType: "customer",
        entityId: id,
        eventType: "customer_updated",
        eventCategory: "system",
        title: `Customer information updated`,
        description: `Customer "${customer.displayName}" details were updated`,
        metadata: customerData,
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail,
      })
    }

    return customer
  } catch (error) {
    throw new Error(`Failed to update customer: ${error instanceof Error ? error.message : error}`)
  }
}

export async function archiveCustomer(id: string, eventContext?: CustomerEventContext): Promise<void> {
  try {
    const customer = await getCustomer(id)
    if (!customer) throw new Error("Customer not found")
    await archiveAccount(id)

    await createEvent({
      entityType: "customer",
      entityId: id,
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

export async function getCustomerOrders(customerId: string) {
  try {
    const rows = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerAccountId: orders.customerAccountId,
        vendorAccountId: orders.vendorAccountId,
        status: orders.status,
        totalPrice: orders.totalPrice,
        vendorPay: orders.vendorPay,
        deliveryDate: orders.deliveryDate,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.customerAccountId, customerId))
      .orderBy(desc(orders.createdAt))

    const vendorsById = await loadAccountRecordMap("vendor", rows.map((row) => row.vendorAccountId))
    return rows.map((row) => ({
      ...row,
      vendor: (row.vendorAccountId && vendorsById.get(row.vendorAccountId)) || null,
    }))
  } catch (error) {
    console.error('Error fetching customer orders:', error)
    return []
  }
}

export async function getCustomerQuotes(customerId: string): Promise<CustomerQuote[]> {
  try {
    const rows = await db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        customerAccountId: quotes.customerAccountId,
        vendorAccountId: quotes.vendorAccountId,
        status: quotes.status,
        total: quotes.total,
        validUntil: quotes.validUntil,
        createdAt: quotes.createdAt,
        convertedToOrderId: quotes.convertedToOrderId,
      })
      .from(quotes)
      .where(and(eq(quotes.customerAccountId, customerId), eq(quotes.isArchived, false)))
      .orderBy(desc(quotes.createdAt))

    const vendorsById = await loadAccountRecordMap("vendor", rows.map((row) => row.vendorAccountId))
    return rows.map((row) => ({
      ...row,
      vendor: (row.vendorAccountId && vendorsById.get(row.vendorAccountId)) || null,
    }))
  } catch (error) {
    console.error('Error fetching customer quotes:', error)
    return []
  }
}

export async function getCustomerStats(customerId: string) {
  try {
    const customerOrders = await getCustomerOrders(customerId)

    return {
      totalOrders: customerOrders.length,
      activeOrders: customerOrders.filter(o => o.status === 'In_Production' || o.status === 'Pending').length,
      completedOrders: customerOrders.filter(o => o.status === 'Completed').length,
      totalSpent: customerOrders.reduce((sum, o) => sum + parseFloat(o.totalPrice || '0'), 0)
    }
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

export async function getCustomerWithAttachments(customerId: string) {
  try {
    const customer = await getCustomer(customerId)
    if (!customer) return null

    const attachments = await getOrganizationAttachments(customer.organizationId)

    return {
      ...customer,
      attachments
    }
  } catch (error) {
    console.error('Error fetching customer with attachments:', error)
    return null
  }
}
