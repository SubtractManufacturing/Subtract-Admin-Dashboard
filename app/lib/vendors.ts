/**
 * Vendors: Organizations with a vendor account (ADR-0013). Ids are vendor
 * account uuids; see `./customers` for the read/write split.
 */
import { desc, eq } from "drizzle-orm"

import { db } from "./db/index.js"
import { orders } from "./db/schema.js"
import { getOrganizationAttachments } from "./attachments.js"
import { createEvent } from "./events.js"
import {
  archiveAccount,
  createAccount,
  loadAccountRecord,
  loadAccountRecordMap,
  loadAccountRecords,
  updateAccountProfile,
  type Executor,
} from "./organizations/accounts.server.js"
import type { AccountProfileInput, Vendor } from "./organizations/types.js"

export type { Vendor }

export type VendorInput = AccountProfileInput

export type VendorEventContext = {
  userId?: string
  userEmail?: string
}

/** Active Vendors, newest first. */
export async function getVendors(): Promise<Vendor[]> {
  try {
    const rows = await loadAccountRecords("vendor", { activeOnly: true })
    return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  } catch (error) {
    console.error('Error fetching vendors:', error)
    return []
  }
}

/** A Vendor by account id, archived or not. Null for unknown or non-uuid ids. */
export async function getVendor(id: string, executor?: Executor): Promise<Vendor | null> {
  try {
    return await loadAccountRecord("vendor", id, executor)
  } catch (error) {
    throw new Error(`Failed to get vendor: ${error}`)
  }
}

export async function getVendorsByIds(ids: string[]): Promise<Vendor[]> {
  if (ids.length === 0) return []
  try {
    return await loadAccountRecords("vendor", { ids })
  } catch (error) {
    console.error("Error fetching vendors by IDs:", error)
    return []
  }
}

export async function getVendorMap(
  ids: Array<string | null | undefined>,
  executor?: Executor,
): Promise<Map<string, Vendor>> {
  return loadAccountRecordMap("vendor", ids, executor)
}

export async function createVendor(
  vendorData: VendorInput,
  eventContext?: VendorEventContext,
  options: { organizationId?: string } = {},
): Promise<Vendor> {
  try {
    const vendor = await createAccount("vendor", vendorData, { organizationId: options.organizationId })

    await createEvent({
      entityType: "vendor",
      entityId: vendor.id,
      eventType: "vendor_created",
      eventCategory: "system",
      title: `Vendor "${vendor.displayName}" created`,
      description: `New vendor added to the system`,
      metadata: {
        displayName: vendor.displayName,
        companyName: vendor.companyName,
        organizationId: vendor.organizationId,
        email: vendor.email,
        phone: vendor.phone
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })

    return vendor
  } catch (error) {
    throw new Error(`Failed to create vendor: ${error instanceof Error ? error.message : error}`)
  }
}

export async function updateVendor(id: string, vendorData: Partial<VendorInput>, eventContext?: VendorEventContext): Promise<Vendor> {
  try {
    const vendor = await updateAccountProfile("vendor", id, vendorData)

    await createEvent({
      entityType: "vendor",
      entityId: id,
      eventType: "vendor_updated",
      eventCategory: "system",
      title: `Vendor information updated`,
      description: `Vendor "${vendor.displayName}" details were updated`,
      metadata: vendorData,
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })

    return vendor
  } catch (error) {
    throw new Error(`Failed to update vendor: ${error instanceof Error ? error.message : error}`)
  }
}

export async function archiveVendor(id: string, eventContext?: VendorEventContext): Promise<void> {
  try {
    const vendor = await getVendor(id)
    if (!vendor) throw new Error("Vendor not found")
    await archiveAccount(id)

    await createEvent({
      entityType: "vendor",
      entityId: id,
      eventType: "vendor_archived",
      eventCategory: "system",
      title: `Vendor archived`,
      description: `Vendor "${vendor.displayName}" has been archived`,
      metadata: {
        displayName: vendor.displayName
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail,
    })
  } catch (error) {
    throw new Error(`Failed to archive vendor: ${error}`)
  }
}

export async function getVendorOrders(vendorId: string) {
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
      .where(eq(orders.vendorAccountId, vendorId))
      .orderBy(desc(orders.createdAt))

    const customersById = await loadAccountRecordMap("customer", rows.map((row) => row.customerAccountId))
    return rows.map((row) => ({
      ...row,
      customer: (row.customerAccountId && customersById.get(row.customerAccountId)) || null,
    }))
  } catch (error) {
    console.error('Error fetching vendor orders:', error)
    return []
  }
}

export async function getVendorStats(vendorId: string) {
  try {
    const vendorOrders = await getVendorOrders(vendorId)

    return {
      totalOrders: vendorOrders.length,
      activeOrders: vendorOrders.filter(o => o.status === 'In_Production' || o.status === 'Pending').length,
      completedOrders: vendorOrders.filter(o => o.status === 'Completed').length,
      totalEarnings: vendorOrders.reduce((sum, o) => sum + parseFloat(o.vendorPay || '0'), 0),
      averageLeadTime: 0
    }
  } catch (error) {
    console.error('Error fetching vendor stats:', error)
    return {
      totalOrders: 0,
      activeOrders: 0,
      completedOrders: 0,
      totalEarnings: 0,
      averageLeadTime: 0
    }
  }
}

export async function getVendorWithAttachments(vendorId: string) {
  try {
    const vendor = await getVendor(vendorId)
    if (!vendor) return null

    const attachments = await getOrganizationAttachments(vendor.organizationId)

    return {
      ...vendor,
      attachments
    }
  } catch (error) {
    console.error('Error fetching vendor with attachments:', error)
    return null
  }
}
