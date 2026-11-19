import { db } from "./db/index.js"
import { attachments, orderAttachments, quoteAttachments, organizationAttachments, partModels } from "./db/schema.js"
import { eq, and, desc } from 'drizzle-orm'
import type { Attachment, NewAttachment } from "./db/schema.js"
import { createEvent } from "./events.js"

export type { Attachment }

export type AttachmentEventContext = {
  userId?: string
  userEmail?: string
  skipEventLogging?: boolean  // Skip event logging for automated operations like PDF generation
  canDeleteProtected?: boolean
}

export async function createAttachment(attachmentData: NewAttachment, eventContext?: AttachmentEventContext): Promise<Attachment> {
  try {
    const result = await db
      .insert(attachments)
      .values(attachmentData)
      .returning()

    const attachment = result[0]

    // Log event (unless skipped for automated operations)
    if (!eventContext?.skipEventLogging) {
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
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail
      })
    }

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

export async function deleteAttachment(id: string, eventContext?: AttachmentEventContext): Promise<void> {
  try {
    // Get attachment details before deletion
    const attachment = await getAttachment(id)
    if (attachment?.isProtected && !eventContext?.canDeleteProtected) {
      throw new Error("Admin or Dev role required to delete this protected attachment")
    }

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
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail
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

export async function deleteAttachmentByS3Key(s3Key: string, eventContext?: AttachmentEventContext): Promise<void> {
  try {
    // Get attachment details before deletion
    const attachment = await getAttachmentByS3Key(s3Key)
    if (attachment?.isProtected && !eventContext?.canDeleteProtected) {
      throw new Error("Admin or Dev role required to delete this protected attachment")
    }

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
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail
      })
    }
  } catch (error) {
    throw new Error(`Failed to delete attachment by S3 key: ${error}`)
  }
}

export async function linkAttachmentToOrder(orderId: number, attachmentId: string, eventContext?: AttachmentEventContext): Promise<void> {
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
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail
    })
  } catch (error) {
    throw new Error(`Failed to link attachment to order: ${error}`)
  }
}

export async function unlinkAttachmentFromOrder(orderId: number, attachmentId: string, eventContext?: AttachmentEventContext): Promise<void> {
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
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail
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

// Organization attachment functions (ADR-0013). Files belong to the
// Organization whichever role it acts in; events are logged on the account
// whose page the change was made from.
export type AttachmentOwner = {
  /** The account whose page the change came from. */
  id: string
  type: "customer" | "vendor"
  organizationId: string
}

export async function linkAttachmentToAccount(owner: AttachmentOwner, attachmentId: string, eventContext?: AttachmentEventContext): Promise<void> {
  try {
    await db
      .insert(organizationAttachments)
      .values({ organizationId: owner.organizationId, attachmentId })
      .onConflictDoNothing()

    const label = owner.type === "customer" ? "Customer" : "Vendor"
    await createEvent({
      entityType: owner.type,
      entityId: owner.id,
      eventType: "attachment_linked",
      eventCategory: "document",
      title: `Attachment Linked to ${label}`,
      description: `Linked attachment to ${owner.type}`,
      metadata: {
        attachmentId,
        organizationId: owner.organizationId,
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail
    })
  } catch (error) {
    throw new Error(`Failed to link attachment to ${owner.type}: ${error}`)
  }
}

export async function unlinkAttachmentFromAccount(owner: AttachmentOwner, attachmentId: string, eventContext?: AttachmentEventContext): Promise<void> {
  try {
    await db
      .delete(organizationAttachments)
      .where(
        and(
          eq(organizationAttachments.organizationId, owner.organizationId),
          eq(organizationAttachments.attachmentId, attachmentId)
        )
      )

    const label = owner.type === "customer" ? "Customer" : "Vendor"
    await createEvent({
      entityType: owner.type,
      entityId: owner.id,
      eventType: "attachment_unlinked",
      eventCategory: "document",
      title: `Attachment Unlinked from ${label}`,
      description: `Unlinked attachment from ${owner.type}`,
      metadata: {
        attachmentId,
        organizationId: owner.organizationId,
      },
      userId: eventContext?.userId,
      userEmail: eventContext?.userEmail
    })
  } catch (error) {
    throw new Error(`Failed to unlink attachment from ${owner.type}: ${error}`)
  }
}

export async function getOrganizationAttachments(organizationId: string): Promise<Attachment[]> {
  try {
    const result = await db
      .select({
        attachment: attachments,
      })
      .from(organizationAttachments)
      .innerJoin(attachments, eq(organizationAttachments.attachmentId, attachments.id))
      .where(eq(organizationAttachments.organizationId, organizationId))
      .orderBy(desc(organizationAttachments.createdAt))

    return result.map(row => row.attachment)
  } catch (error) {
    console.error('Error fetching organization attachments:', error)
    return []
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

export async function authorizeAttachmentDeletion(input: {
  attachmentId: string
  eventContext?: AttachmentEventContext
} & (
  | { entityType: "order" | "quote"; entityId: number }
  | { entityType: "organization"; entityId: string }
)): Promise<Attachment | null> {
  const rows =
    input.entityType === "order"
      ? await db
          .select({ attachment: attachments })
          .from(orderAttachments)
          .innerJoin(attachments, eq(orderAttachments.attachmentId, attachments.id))
          .where(and(eq(orderAttachments.orderId, input.entityId), eq(orderAttachments.attachmentId, input.attachmentId)))
          .limit(1)
      : input.entityType === "quote"
        ? await db
            .select({ attachment: attachments })
            .from(quoteAttachments)
            .innerJoin(attachments, eq(quoteAttachments.attachmentId, attachments.id))
            .where(and(eq(quoteAttachments.quoteId, input.entityId), eq(quoteAttachments.attachmentId, input.attachmentId)))
            .limit(1)
        : await db
            .select({ attachment: attachments })
            .from(organizationAttachments)
            .innerJoin(attachments, eq(organizationAttachments.attachmentId, attachments.id))
            .where(
              and(
                eq(organizationAttachments.organizationId, String(input.entityId)),
                eq(organizationAttachments.attachmentId, input.attachmentId),
              ),
            )
            .limit(1)
  const row = rows[0]
  if (!row) return null
  if (row.attachment.isProtected && !input.eventContext?.canDeleteProtected) {
    throw new Error("Admin or Dev role required to delete this protected attachment")
  }
  return row.attachment
}
