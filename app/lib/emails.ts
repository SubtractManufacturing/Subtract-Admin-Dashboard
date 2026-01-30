import { randomUUID } from "crypto";
import { db } from "./db";
import {
  emails,
  emailAttachments,
  type Email,
  type NewEmail,
  type EmailAttachment,
  type NewEmailAttachment,
} from "./db/schema";
import { eq, desc, asc, and, or } from "drizzle-orm";

// CONSTRAINT 2: Database Integrity & Performance
// Thread ID logic: randomUUID() for roots, inherit parent's UUID for replies
export async function getOrCreateThreadId(
  inReplyTo: string | null,
  messageId: string
): Promise<string> {
  if (!inReplyTo) {
    // New conversation - generate new thread ID using randomUUID()
    const threadId = randomUUID();
    console.log(`Created new thread: ${threadId} for message: ${messageId}`);
    return threadId;
  }

  // Lookup parent email by Message-ID (uses emails_message_id_idx index)
  const parentEmail = await db.query.emails.findFirst({
    where: eq(emails.messageId, inReplyTo),
    columns: { threadId: true, id: true },
  });

  if (parentEmail) {
    // Reply to existing thread - inherit parent's thread_id
    console.log(
      `Inheriting thread ${parentEmail.threadId} from parent email ${parentEmail.id}`
    );
    return parentEmail.threadId;
  }

  // Parent not found (external email or orphaned reply) - create new thread
  const threadId = randomUUID();
  console.warn(
    `Parent email with Message-ID '${inReplyTo}' not found. Creating new thread: ${threadId}`
  );
  return threadId;
}

/**
 * Get all emails in a thread, ordered by sent date
 */
export async function getThreadEmails(threadId: string): Promise<Email[]> {
  return db.query.emails.findMany({
    where: eq(emails.threadId, threadId),
    orderBy: asc(emails.sentAt),
  });
}

/**
 * Create a new email record
 */
export async function createEmail(
  data: Omit<NewEmail, "id" | "createdAt" | "updatedAt">
): Promise<Email> {
  const [email] = await db
    .insert(emails)
    .values({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return email;
}

/**
 * Get an email by ID
 */
export async function getEmailById(id: number): Promise<Email | null> {
  const email = await db.query.emails.findFirst({
    where: eq(emails.id, id),
  });
  return email || null;
}

/**
 * Get an email by Postmark message ID
 */
export async function getEmailByPostmarkId(
  postmarkMessageId: string
): Promise<Email | null> {
  const email = await db.query.emails.findFirst({
    where: eq(emails.postmarkMessageId, postmarkMessageId),
  });
  return email || null;
}

/**
 * Update email status and metadata
 */
export async function updateEmailStatus(
  postmarkMessageId: string,
  status: "sent" | "delivered" | "bounced" | "spam_complaint" | "failed" | null,
  updates: Partial<{
    deliveredAt: Date;
    bouncedAt: Date;
    openedAt: Date;
    clickedAt: Date;
    metadata: Record<string, unknown>;
  }>
): Promise<Email | null> {
  const existing = await getEmailByPostmarkId(postmarkMessageId);
  if (!existing) {
    console.warn(`Email with Postmark ID '${postmarkMessageId}' not found`);
    return null;
  }

  const updateData: Partial<Email> = {
    updatedAt: new Date(),
    ...updates,
  };

  if (status) {
    updateData.status = status;
  }

  // Merge metadata if provided
  if (updates.metadata) {
    updateData.metadata = {
      ...(existing.metadata as Record<string, unknown> || {}),
      ...updates.metadata,
    };
  }

  const [updated] = await db
    .update(emails)
    .set(updateData)
    .where(eq(emails.postmarkMessageId, postmarkMessageId))
    .returning();

  return updated || null;
}

/**
 * Get emails for a specific entity (quote, order, customer, vendor)
 */
export async function getEmailsForEntity(
  entityType: "quote" | "order" | "customer" | "vendor",
  entityId: number,
  options?: { limit?: number; offset?: number }
): Promise<Email[]> {
  const whereClause =
    entityType === "quote"
      ? eq(emails.quoteId, entityId)
      : entityType === "order"
        ? eq(emails.orderId, entityId)
        : entityType === "customer"
          ? eq(emails.customerId, entityId)
          : eq(emails.vendorId, entityId);

  return db.query.emails.findMany({
    where: whereClause,
    orderBy: desc(emails.sentAt),
    limit: options?.limit || 50,
    offset: options?.offset || 0,
  });
}

/**
 * Get all emails with pagination and filtering
 */
export async function getEmails(options?: {
  direction?: "inbound" | "outbound";
  limit?: number;
  offset?: number;
}): Promise<Email[]> {
  const conditions = [];

  if (options?.direction) {
    conditions.push(eq(emails.direction, options.direction));
  }

  return db.query.emails.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: desc(emails.sentAt),
    limit: options?.limit || 25,
    offset: options?.offset || 0,
  });
}

/**
 * Get total email count for pagination
 */
export async function getEmailCount(options?: {
  direction?: "inbound" | "outbound";
}): Promise<number> {
  const result = await db
    .select({ count: emails.id })
    .from(emails)
    .where(options?.direction ? eq(emails.direction, options.direction) : undefined);

  // Count the returned rows
  return result.length;
}

// ============================================
// Email Attachments
// ============================================

/**
 * Create an email attachment record
 */
export async function createEmailAttachment(
  data: Omit<NewEmailAttachment, "id" | "createdAt">
): Promise<EmailAttachment> {
  const [attachment] = await db
    .insert(emailAttachments)
    .values({
      ...data,
      createdAt: new Date(),
    })
    .returning();

  return attachment;
}

/**
 * Get attachments for an email
 */
export async function getEmailAttachments(
  emailId: number
): Promise<EmailAttachment[]> {
  return db.query.emailAttachments.findMany({
    where: eq(emailAttachments.emailId, emailId),
  });
}

/**
 * Get an attachment by ID
 */
export async function getEmailAttachmentById(
  id: number
): Promise<EmailAttachment | null> {
  const attachment = await db.query.emailAttachments.findFirst({
    where: eq(emailAttachments.id, id),
  });
  return attachment || null;
}
