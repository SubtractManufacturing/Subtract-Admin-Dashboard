import { db } from "./db/index.js"
import { attachments, orderAttachments } from "./db/schema.js"
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