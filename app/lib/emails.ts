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
import { eq, desc, asc, and } from "drizzle-orm";

// ============================================
// Thread Types
// ============================================

export interface ThreadSummary {
  threadId: string;
  subject: string;
  participants: string[];
  lastEmailAt: Date | null;
  emailCount: number;
  latestSnippet: string;
  quoteId: number | null;
  orderId: number | null;
  customerId: number | null;
  vendorId: number | null;
  // Latest email info for display
  latestFromAddress: string;
  latestFromName: string | null;
  latestDirection: "inbound" | "outbound";
}

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

// ============================================
// Thread Queries
// ============================================

/**
 * Get email threads with summaries, grouped by threadId
 * Returns threads sorted by most recent email
 */
export async function getEmailThreads(options?: {
  direction?: "inbound" | "outbound";
  limit?: number;
  offset?: number;
}): Promise<ThreadSummary[]> {
  const limitVal = options?.limit || 25;
  const offsetVal = options?.offset || 0;

  // Get all emails with optional direction filter
  const conditions = [];
  if (options?.direction) {
    conditions.push(eq(emails.direction, options.direction));
  }

  const allEmails = await db.query.emails.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: desc(emails.sentAt),
  });

  // Group emails by threadId
  const threadMap = new Map<string, typeof allEmails>();
  for (const email of allEmails) {
    const existing = threadMap.get(email.threadId) || [];
    existing.push(email);
    threadMap.set(email.threadId, existing);
  }

  // Convert to thread summaries
  const threadSummaries: ThreadSummary[] = [];
  for (const [threadId, threadEmails] of threadMap) {
    // Sort emails by date (newest first for getting latest)
    const sortedEmails = [...threadEmails].sort((a, b) => {
      const dateA = a.sentAt ? new Date(a.sentAt).getTime() : 0;
      const dateB = b.sentAt ? new Date(b.sentAt).getTime() : 0;
      return dateB - dateA;
    });

    const latestEmail = sortedEmails[0];
    const firstEmail = sortedEmails[sortedEmails.length - 1];
    const participants = [...new Set(threadEmails.map((e) => e.fromAddress))];

    threadSummaries.push({
      threadId,
      subject: firstEmail.subject || "(No Subject)",
      participants,
      lastEmailAt: latestEmail.sentAt,
      emailCount: threadEmails.length,
      latestSnippet: truncateText(latestEmail.textBody || "", 150),
      quoteId: threadEmails.find((e) => e.quoteId)?.quoteId || null,
      orderId: threadEmails.find((e) => e.orderId)?.orderId || null,
      customerId: threadEmails.find((e) => e.customerId)?.customerId || null,
      vendorId: threadEmails.find((e) => e.vendorId)?.vendorId || null,
      latestFromAddress: latestEmail.fromAddress,
      latestFromName: latestEmail.fromName,
      latestDirection: latestEmail.direction,
    });
  }

  // Sort by most recent and apply pagination
  threadSummaries.sort((a, b) => {
    const dateA = a.lastEmailAt ? new Date(a.lastEmailAt).getTime() : 0;
    const dateB = b.lastEmailAt ? new Date(b.lastEmailAt).getTime() : 0;
    return dateB - dateA;
  });

  return threadSummaries.slice(offsetVal, offsetVal + limitVal);
}

/**
 * Get a single thread by ID with all its emails
 */
export async function getThreadById(threadId: string): Promise<{
  thread: ThreadSummary;
  emails: Email[];
} | null> {
  // Get all emails in the thread
  const threadEmails = await db.query.emails.findMany({
    where: eq(emails.threadId, threadId),
    orderBy: asc(emails.sentAt),
  });

  if (threadEmails.length === 0) {
    return null;
  }

  // Build thread summary from the emails
  const latestEmail = threadEmails[threadEmails.length - 1];
  const firstEmail = threadEmails[0];
  const participants = [...new Set(threadEmails.map((e) => e.fromAddress))];

  const thread: ThreadSummary = {
    threadId,
    subject: firstEmail.subject || "(No Subject)",
    participants,
    lastEmailAt: latestEmail.sentAt,
    emailCount: threadEmails.length,
    latestSnippet: truncateText(latestEmail.textBody || "", 150),
    quoteId: threadEmails.find((e) => e.quoteId)?.quoteId || null,
    orderId: threadEmails.find((e) => e.orderId)?.orderId || null,
    customerId: threadEmails.find((e) => e.customerId)?.customerId || null,
    vendorId: threadEmails.find((e) => e.vendorId)?.vendorId || null,
    latestFromAddress: latestEmail.fromAddress,
    latestFromName: latestEmail.fromName,
    latestDirection: latestEmail.direction,
  };

  return { thread, emails: threadEmails };
}

/**
 * Get thread count for pagination
 */
export async function getThreadCount(options?: {
  direction?: "inbound" | "outbound";
}): Promise<number> {
  // Get all emails with optional direction filter
  const conditions = [];
  if (options?.direction) {
    conditions.push(eq(emails.direction, options.direction));
  }

  const allEmails = await db.query.emails.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    columns: { threadId: true },
  });

  // Count unique thread IDs
  const uniqueThreads = new Set(allEmails.map((e) => e.threadId));
  return uniqueThreads.size;
}

/**
 * Helper to truncate text with ellipsis
 */
function truncateText(text: string, maxLength: number): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + "...";
}
