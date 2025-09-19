import { db } from "./db/index.js"
import { attachments, orderAttachments, customerAttachments, vendorAttachments, partModels } from "./db/schema.js"
import { eq, and } from 'drizzle-orm'
import type { Attachment, NewAttachment } from "./db/schema.js"
import { createEvent } from "./events.js"

export type { Attachment }

export async function createAttachment(attachmentData: NewAttachment): Promise<Attachment> {
  try {
    const result = await db
      .insert(attachments)
      .values(attachmentData)
      .returning()

    const attachment = result[0]

    // Log event
    await createEvent({
      entityType: "attachment",
      entityId: attachment.id,
      eventType: "attachment_created",
      eventCategory: "document",
      title: "Attachment Created",
      description: `Created attachment: ${attachment.fileName}`,
      metadata: {
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        fileSize: attachment.fileSize
      }
    })

    return attachment
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
    // Get attachment details before deletion
    const attachment = await getAttachment(id)

    await db
      .delete(attachments)
      .where(eq(attachments.id, id))

    // Log event if attachment existed
    if (attachment) {
      await createEvent({
        entityType: "attachment",
        entityId: id,
        eventType: "attachment_deleted",
        eventCategory: "document",
        title: "Attachment Deleted",
        description: `Deleted attachment: ${attachment.fileName}`,
        metadata: {
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          s3Key: attachment.s3Key
        }
      })
    }
  } catch (error) {
    throw new Error(`Failed to delete attachment: ${error}`)
  }
}

export async function getAttachmentByS3Key(s3Key: string): Promise<Attachment | null> {
  try {
    const result = await db
      .select()
      .from(attachments)
      .where(eq(attachments.s3Key, s3Key))
      .limit(1)

    return result[0] || null
  } catch (error) {
    throw new Error(`Failed to get attachment by S3 key: ${error}`)
  }
}

export async function deleteAttachmentByS3Key(s3Key: string): Promise<void> {
  try {
    // Get attachment details before deletion
    const attachment = await getAttachmentByS3Key(s3Key)

    await db
      .delete(attachments)
      .where(eq(attachments.s3Key, s3Key))

    // Log event if attachment existed
    if (attachment) {
      await createEvent({
        entityType: "attachment",
        entityId: attachment.id,
        eventType: "attachment_deleted",
        eventCategory: "document",
        title: "Attachment Deleted by S3 Key",
        description: `Deleted attachment: ${attachment.fileName}`,
        metadata: {
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          s3Key: attachment.s3Key
        }
      })
    }
  } catch (error) {
    throw new Error(`Failed to delete attachment by S3 key: ${error}`)
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

    // Log event
    await createEvent({
      entityType: "order",
      entityId: orderId.toString(),
      eventType: "attachment_linked",
      eventCategory: "document",
      title: "Attachment Linked to Order",
      description: `Linked attachment to order`,
      metadata: {
        attachmentId
      }
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

    // Log event
    await createEvent({
      entityType: "order",
      entityId: orderId.toString(),
      eventType: "attachment_unlinked",
      eventCategory: "document",
      title: "Attachment Unlinked from Order",
      description: `Unlinked attachment from order`,
      metadata: {
        attachmentId
      }
    })
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