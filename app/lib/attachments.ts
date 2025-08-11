import { db } from "./db/index.js"
import { attachments, orderAttachments, customerAttachments, vendorAttachments, partModels } from "./db/schema.js"
import { eq, and } from 'drizzle-orm'
import type { Attachment, NewAttachment } from "./db/schema.js"

export type { Attachment }

export async function createAttachment(attachmentData: NewAttachment): Promise<Attachment> {
  try {
    const result = await db
      .insert(attachments)
      .values(attachmentData)
      .returning()

    return result[0]
  } catch (error) {
    throw new Error(`Failed to create attachment: ${error}`)
  }
}

export async function getAttachment(id: string): Promise<Attachment | null> {
  try {
    const result = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, id))
      .limit(1)

    return result[0] || null
  } catch (error) {
    throw new Error(`Failed to get attachment: ${error}`)
  }
}

export async function deleteAttachment(id: string): Promise<void> {
  try {
    await db
      .delete(attachments)
      .where(eq(attachments.id, id))
  } catch (error) {
    throw new Error(`Failed to delete attachment: ${error}`)
  }
}

export async function linkAttachmentToOrder(orderId: number, attachmentId: string): Promise<void> {
  try {
    await db
      .insert(orderAttachments)
      .values({
        orderId,
        attachmentId,
      })
  } catch (error) {
    throw new Error(`Failed to link attachment to order: ${error}`)
  }
}

export async function unlinkAttachmentFromOrder(orderId: number, attachmentId: string): Promise<void> {
  try {
    await db
      .delete(orderAttachments)
      .where(
        and(
          eq(orderAttachments.orderId, orderId),
          eq(orderAttachments.attachmentId, attachmentId)
        )
      )
  } catch (error) {
    throw new Error(`Failed to unlink attachment from order: ${error}`)
  }
}

export async function getOrderAttachments(orderId: number): Promise<Attachment[]> {
  try {
    const result = await db
      .select({
        attachment: attachments,
      })
      .from(orderAttachments)
      .innerJoin(attachments, eq(orderAttachments.attachmentId, attachments.id))
      .where(eq(orderAttachments.orderId, orderId))

    return result.map(row => row.attachment)
  } catch (error) {
    console.error('Error fetching order attachments:', error)
    return []
  }
}

// Customer attachment functions
export async function linkAttachmentToCustomer(customerId: number, attachmentId: string): Promise<void> {
  try {
    await db
      .insert(customerAttachments)
      .values({
        customerId,
        attachmentId,
      })
  } catch (error) {
    throw new Error(`Failed to link attachment to customer: ${error}`)
  }
}

export async function unlinkAttachmentFromCustomer(customerId: number, attachmentId: string): Promise<void> {
  try {
    await db
      .delete(customerAttachments)
      .where(
        and(
          eq(customerAttachments.customerId, customerId),
          eq(customerAttachments.attachmentId, attachmentId)
        )
      )
  } catch (error) {
    throw new Error(`Failed to unlink attachment from customer: ${error}`)
  }
}

export async function getCustomerAttachments(customerId: number): Promise<Attachment[]> {
  try {
    const result = await db
      .select({
        attachment: attachments,
      })
      .from(customerAttachments)
      .innerJoin(attachments, eq(customerAttachments.attachmentId, attachments.id))
      .where(eq(customerAttachments.customerId, customerId))

    return result.map(row => row.attachment)
  } catch (error) {
    console.error('Error fetching customer attachments:', error)
    return []
  }
}

// Vendor attachment functions
export async function linkAttachmentToVendor(vendorId: number, attachmentId: string): Promise<void> {
  try {
    await db
      .insert(vendorAttachments)
      .values({
        vendorId,
        attachmentId,
      })
  } catch (error) {
    throw new Error(`Failed to link attachment to vendor: ${error}`)
  }
}

// Part attachment functions (for 3D models)
export async function linkAttachmentToPart(partId: string, attachmentId: string): Promise<void> {
  try {
    await db
      .insert(partModels)
      .values({
        partId,
        attachmentId,
        version: 1,
      })
  } catch (error) {
    throw new Error(`Failed to link attachment to part: ${error}`)
  }
}

export async function unlinkAttachmentFromVendor(vendorId: number, attachmentId: string): Promise<void> {
  try {
    await db
      .delete(vendorAttachments)
      .where(
        and(
          eq(vendorAttachments.vendorId, vendorId),
          eq(vendorAttachments.attachmentId, attachmentId)
        )
      )
  } catch (error) {
    throw new Error(`Failed to unlink attachment from vendor: ${error}`)
  }
}

export async function getVendorAttachments(vendorId: number): Promise<Attachment[]> {
  try {
    const result = await db
      .select({
        attachment: attachments,
      })
      .from(vendorAttachments)
      .innerJoin(attachments, eq(vendorAttachments.attachmentId, attachments.id))
      .where(eq(vendorAttachments.vendorId, vendorId))

    return result.map(row => row.attachment)
  } catch (error) {
    console.error('Error fetching vendor attachments:', error)
    return []
  }
}