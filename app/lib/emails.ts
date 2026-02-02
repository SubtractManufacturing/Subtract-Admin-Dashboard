import { randomUUID } from "crypto";
import { db } from "./db";
import {
  emails,
  emailAttachments,
  emailThreads,
  emailThreadReads,
  emailThreadAssignments,
  users,
  type Email,
  type NewEmail,
  type EmailAttachment,
  type NewEmailAttachment,
  type EmailThread,
  type NewEmailThread,
} from "./db/schema";
import { eq, desc, asc, and, inArray } from "drizzle-orm";

// ============================================
// Thread Types
// ============================================

export interface AssignedUser {
  userId: string;
  userName: string | null;
  userEmail: string;
  hasRead: boolean;
}

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
  // Per-user read tracking
  isReadByCurrentUser: boolean;
  // Multi-user assignment support
  assignedUserIds: string[];
  assignedUsers: AssignedUser[];
  // Thread metadata from emailThreads table
  isImportant: boolean;
  category: "general" | "order" | "quote" | "support" | "sales";
  isArchived: boolean;
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
  currentUserId?: string;
  assignedToMe?: boolean;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<ThreadSummary[]> {
  const limitVal = options?.limit || 25;
  const offsetVal = options?.offset || 0;
  const currentUserId = options?.currentUserId;

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

  // Get thread IDs
  const threadIds = Array.from(threadMap.keys());

  // Batch load read status for current user
  const userReadMap = new Map<string, boolean>();
  if (currentUserId && threadIds.length > 0) {
    const reads = await db.query.emailThreadReads.findMany({
      where: and(
        inArray(emailThreadReads.threadId, threadIds),
        eq(emailThreadReads.userId, currentUserId)
      ),
    });
    for (const read of reads) {
      userReadMap.set(read.threadId, true);
    }
  }

  // Batch load assignments with user info
  const assignmentMap = new Map<string, AssignedUser[]>();
  if (threadIds.length > 0) {
    const assignments = await db
      .select({
        threadId: emailThreadAssignments.threadId,
        userId: emailThreadAssignments.userId,
        userName: users.name,
        userEmail: users.email,
      })
      .from(emailThreadAssignments)
      .innerJoin(users, eq(emailThreadAssignments.userId, users.id))
      .where(inArray(emailThreadAssignments.threadId, threadIds));

    // Get read status for all assigned users
    const assignedUserIds = [...new Set(assignments.map(a => a.userId))];
    const assignedUserReadMap = new Map<string, Set<string>>(); // threadId -> Set of userIds who have read

    if (assignedUserIds.length > 0) {
      const assignedReads = await db.query.emailThreadReads.findMany({
        where: and(
          inArray(emailThreadReads.threadId, threadIds),
          inArray(emailThreadReads.userId, assignedUserIds)
        ),
      });
      for (const read of assignedReads) {
        if (!assignedUserReadMap.has(read.threadId)) {
          assignedUserReadMap.set(read.threadId, new Set());
        }
        assignedUserReadMap.get(read.threadId)!.add(read.userId);
      }
    }

    for (const assignment of assignments) {
      if (!assignmentMap.has(assignment.threadId)) {
        assignmentMap.set(assignment.threadId, []);
      }
      const threadReaders = assignedUserReadMap.get(assignment.threadId) || new Set();
      assignmentMap.get(assignment.threadId)!.push({
        userId: assignment.userId,
        userName: assignment.userName,
        userEmail: assignment.userEmail,
        hasRead: threadReaders.has(assignment.userId),
      });
    }
  }

  // Batch load thread metadata
  const threadMetadataMap = new Map<string, { isImportant: boolean; category: string; isArchived: boolean }>();
  if (threadIds.length > 0) {
    const threadRecords = await db.query.emailThreads.findMany({
      where: inArray(emailThreads.id, threadIds),
      columns: {
        id: true,
        isImportant: true,
        category: true,
        isArchived: true,
      },
    });
    for (const record of threadRecords) {
      threadMetadataMap.set(record.id, {
        isImportant: record.isImportant,
        category: record.category,
        isArchived: record.isArchived,
      });
    }
  }

  // If filtering by assignedToMe, get the list of thread IDs assigned to user
  let assignedToMeThreadIds: Set<string> | null = null;
  if (options?.assignedToMe && currentUserId) {
    const myAssignments = await db.query.emailThreadAssignments.findMany({
      where: eq(emailThreadAssignments.userId, currentUserId),
      columns: { threadId: true },
    });
    assignedToMeThreadIds = new Set(myAssignments.map(a => a.threadId));
  }

  // Convert to thread summaries
  const threadSummaries: ThreadSummary[] = [];
  for (const [threadId, threadEmails] of threadMap) {
    // Filter by assignedToMe if needed
    if (assignedToMeThreadIds && !assignedToMeThreadIds.has(threadId)) {
      continue;
    }

    const isReadByCurrentUser = userReadMap.get(threadId) || false;

    // Filter by unread if needed
    if (options?.unreadOnly && isReadByCurrentUser) {
      continue;
    }

    // Sort emails by date (newest first for getting latest)
    const sortedEmails = [...threadEmails].sort((a, b) => {
      const dateA = a.sentAt ? new Date(a.sentAt).getTime() : 0;
      const dateB = b.sentAt ? new Date(b.sentAt).getTime() : 0;
      return dateB - dateA;
    });

    const latestEmail = sortedEmails[0];
    const firstEmail = sortedEmails[sortedEmails.length - 1];
    const participants = [...new Set(threadEmails.map((e) => e.fromAddress))];
    const assignedUsers = assignmentMap.get(threadId) || [];
    const metadata = threadMetadataMap.get(threadId);

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
      isReadByCurrentUser,
      assignedUserIds: assignedUsers.map(u => u.userId),
      assignedUsers,
      isImportant: metadata?.isImportant ?? false,
      category: (metadata?.category as ThreadSummary["category"]) ?? "general",
      isArchived: metadata?.isArchived ?? false,
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
export async function getThreadById(threadId: string, currentUserId?: string): Promise<{
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

  // Get read status for current user
  let isReadByCurrentUser = false;
  if (currentUserId) {
    const readRecord = await db.query.emailThreadReads.findFirst({
      where: and(
        eq(emailThreadReads.threadId, threadId),
        eq(emailThreadReads.userId, currentUserId)
      ),
    });
    isReadByCurrentUser = !!readRecord;
  }

  // Get assignments with user info
  const assignments = await db
    .select({
      userId: emailThreadAssignments.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(emailThreadAssignments)
    .innerJoin(users, eq(emailThreadAssignments.userId, users.id))
    .where(eq(emailThreadAssignments.threadId, threadId));

  // Get read status for all assigned users
  const assignedUserIds = assignments.map(a => a.userId);
  const assignedUserReadMap = new Map<string, boolean>();
  if (assignedUserIds.length > 0) {
    const assignedReads = await db.query.emailThreadReads.findMany({
      where: and(
        eq(emailThreadReads.threadId, threadId),
        inArray(emailThreadReads.userId, assignedUserIds)
      ),
    });
    for (const read of assignedReads) {
      assignedUserReadMap.set(read.userId, true);
    }
  }

  const assignedUsers: AssignedUser[] = assignments.map(a => ({
    userId: a.userId,
    userName: a.userName,
    userEmail: a.userEmail,
    hasRead: assignedUserReadMap.get(a.userId) || false,
  }));

  // Get thread metadata
  const threadMetadata = await db.query.emailThreads.findFirst({
    where: eq(emailThreads.id, threadId),
    columns: {
      isImportant: true,
      category: true,
      isArchived: true,
    },
  });

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
    isReadByCurrentUser,
    assignedUserIds: assignedUsers.map(u => u.userId),
    assignedUsers,
    isImportant: threadMetadata?.isImportant ?? false,
    category: (threadMetadata?.category as ThreadSummary["category"]) ?? "general",
    isArchived: threadMetadata?.isArchived ?? false,
  };

  return { thread, emails: threadEmails };
}

/**
 * Get thread count for pagination
 */
export async function getThreadCount(options?: {
  direction?: "inbound" | "outbound";
  currentUserId?: string;
  assignedToMe?: boolean;
  unreadOnly?: boolean;
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
  let uniqueThreads = new Set(allEmails.map((e) => e.threadId));

  // Filter by assignedToMe if needed
  if (options?.assignedToMe && options?.currentUserId) {
    const myAssignments = await db.query.emailThreadAssignments.findMany({
      where: eq(emailThreadAssignments.userId, options.currentUserId),
      columns: { threadId: true },
    });
    const assignedThreadIds = new Set(myAssignments.map(a => a.threadId));
    uniqueThreads = new Set([...uniqueThreads].filter(id => assignedThreadIds.has(id)));
  }

  // Filter by unread if needed
  if (options?.unreadOnly && options?.currentUserId) {
    const threadIds = [...uniqueThreads];
    if (threadIds.length > 0) {
      const reads = await db.query.emailThreadReads.findMany({
        where: and(
          inArray(emailThreadReads.threadId, threadIds),
          eq(emailThreadReads.userId, options.currentUserId)
        ),
        columns: { threadId: true },
      });
      const readThreadIds = new Set(reads.map(r => r.threadId));
      uniqueThreads = new Set([...uniqueThreads].filter(id => !readThreadIds.has(id)));
    }
  }

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

// ============================================
// Thread State Management
// ============================================

/**
 * Get or create an email thread record
 */
export async function getOrCreateEmailThread(
  threadId: string,
  initialData?: Partial<NewEmailThread>
): Promise<EmailThread> {
  // Try to find existing thread
  const existing = await db.query.emailThreads.findFirst({
    where: eq(emailThreads.id, threadId),
  });

  if (existing) {
    return existing;
  }

  // Create new thread record
  const [thread] = await db
    .insert(emailThreads)
    .values({
      id: threadId,
      subject: initialData?.subject || "(No Subject)",
      isRead: initialData?.isRead ?? false,
      isImportant: initialData?.isImportant ?? false,
      isArchived: initialData?.isArchived ?? false,
      category: initialData?.category ?? "general",
      quoteId: initialData?.quoteId,
      orderId: initialData?.orderId,
      customerId: initialData?.customerId,
      vendorId: initialData?.vendorId,
      emailCount: initialData?.emailCount ?? 0,
      lastEmailAt: initialData?.lastEmailAt,
      latestSnippet: initialData?.latestSnippet,
      participants: initialData?.participants,
      latestFromAddress: initialData?.latestFromAddress,
      latestFromName: initialData?.latestFromName,
      latestDirection: initialData?.latestDirection,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return thread;
}

/**
 * Mark a thread as read or unread
 */
export async function markThreadAsRead(
  threadId: string,
  isRead: boolean
): Promise<EmailThread | null> {
  // Ensure thread exists
  await getOrCreateEmailThread(threadId, {
    subject: "(No Subject)",
  });

  const [updated] = await db
    .update(emailThreads)
    .set({
      isRead,
      updatedAt: new Date(),
    })
    .where(eq(emailThreads.id, threadId))
    .returning();

  return updated || null;
}

/**
 * Mark a thread as important/starred
 */
export async function markThreadAsImportant(
  threadId: string,
  isImportant: boolean
): Promise<EmailThread | null> {
  // Ensure thread exists
  await getOrCreateEmailThread(threadId, {
    subject: "(No Subject)",
  });

  const [updated] = await db
    .update(emailThreads)
    .set({
      isImportant,
      updatedAt: new Date(),
    })
    .where(eq(emailThreads.id, threadId))
    .returning();

  return updated || null;
}

// ============================================
// Per-User Read Tracking
// ============================================

/**
 * Mark thread as read by a specific user
 */
export async function markThreadAsReadByUser(
  threadId: string,
  userId: string
): Promise<void> {
  // Ensure thread exists
  await getOrCreateEmailThread(threadId, {
    subject: "(No Subject)",
  });

  // Upsert the read record
  await db
    .insert(emailThreadReads)
    .values({
      threadId,
      userId,
      readAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [emailThreadReads.threadId, emailThreadReads.userId],
      set: {
        readAt: new Date(),
      },
    });
}

/**
 * Mark thread as unread by a specific user (removes their read record)
 */
export async function markThreadAsUnreadByUser(
  threadId: string,
  userId: string
): Promise<void> {
  await db
    .delete(emailThreadReads)
    .where(
      and(
        eq(emailThreadReads.threadId, threadId),
        eq(emailThreadReads.userId, userId)
      )
    );
}

/**
 * Mark thread as unread for all users (when a new reply arrives)
 */
export async function markThreadAsUnreadForAll(threadId: string): Promise<void> {
  await db
    .delete(emailThreadReads)
    .where(eq(emailThreadReads.threadId, threadId));
}

/**
 * Check if a user has read a thread
 */
export async function hasUserReadThread(
  threadId: string,
  userId: string
): Promise<boolean> {
  const read = await db.query.emailThreadReads.findFirst({
    where: and(
      eq(emailThreadReads.threadId, threadId),
      eq(emailThreadReads.userId, userId)
    ),
  });
  return !!read;
}

/**
 * Get all users who have read a thread
 */
export async function getThreadReaders(
  threadId: string
): Promise<Array<{ userId: string; readAt: Date }>> {
  const reads = await db.query.emailThreadReads.findMany({
    where: eq(emailThreadReads.threadId, threadId),
  });
  return reads.map(r => ({
    userId: r.userId,
    readAt: r.readAt,
  }));
}

// ============================================
// Multi-User Thread Assignments
// ============================================

/**
 * Assign multiple users to a thread
 */
export async function assignUsersToThread(
  threadId: string,
  userIds: string[],
  assignedBy: string
): Promise<void> {
  // Ensure thread exists
  await getOrCreateEmailThread(threadId, {
    subject: "(No Subject)",
  });

  // Remove existing assignments not in new list
  const existingAssignments = await db.query.emailThreadAssignments.findMany({
    where: eq(emailThreadAssignments.threadId, threadId),
  });
  const existingUserIds = existingAssignments.map(a => a.userId);
  const toRemove = existingUserIds.filter(id => !userIds.includes(id));
  const toAdd = userIds.filter(id => !existingUserIds.includes(id));

  // Remove old assignments
  if (toRemove.length > 0) {
    await db
      .delete(emailThreadAssignments)
      .where(
        and(
          eq(emailThreadAssignments.threadId, threadId),
          inArray(emailThreadAssignments.userId, toRemove)
        )
      );
  }

  // Add new assignments
  if (toAdd.length > 0) {
    await db.insert(emailThreadAssignments).values(
      toAdd.map(userId => ({
        threadId,
        userId,
        assignedAt: new Date(),
        assignedBy,
      }))
    );
  }
}

/**
 * Unassign a specific user from a thread
 */
export async function unassignUserFromThread(
  threadId: string,
  userId: string
): Promise<void> {
  await db
    .delete(emailThreadAssignments)
    .where(
      and(
        eq(emailThreadAssignments.threadId, threadId),
        eq(emailThreadAssignments.userId, userId)
      )
    );
}

/**
 * Unassign all users from a thread
 */
export async function unassignAllFromThread(threadId: string): Promise<void> {
  await db
    .delete(emailThreadAssignments)
    .where(eq(emailThreadAssignments.threadId, threadId));
}

/**
 * Get all assignments for a thread with user info
 */
export async function getThreadAssignments(
  threadId: string
): Promise<AssignedUser[]> {
  const assignments = await db
    .select({
      userId: emailThreadAssignments.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(emailThreadAssignments)
    .innerJoin(users, eq(emailThreadAssignments.userId, users.id))
    .where(eq(emailThreadAssignments.threadId, threadId));

  // Get read status for all assigned users
  const userIds = assignments.map(a => a.userId);
  const readMap = new Map<string, boolean>();
  if (userIds.length > 0) {
    const reads = await db.query.emailThreadReads.findMany({
      where: and(
        eq(emailThreadReads.threadId, threadId),
        inArray(emailThreadReads.userId, userIds)
      ),
    });
    for (const read of reads) {
      readMap.set(read.userId, true);
    }
  }

  return assignments.map(a => ({
    userId: a.userId,
    userName: a.userName,
    userEmail: a.userEmail,
    hasRead: readMap.get(a.userId) || false,
  }));
}

/**
 * Auto-assign a thread to a user (only if not already assigned)
 */
export async function autoAssignThreadToUser(
  threadId: string,
  userId: string
): Promise<boolean> {
  // Check if thread has any assignments
  const existingAssignments = await db.query.emailThreadAssignments.findMany({
    where: eq(emailThreadAssignments.threadId, threadId),
    columns: { userId: true },
  });

  if (existingAssignments.length > 0) {
    // Thread already has assignments, don't auto-assign
    return false;
  }

  // Ensure thread exists
  await getOrCreateEmailThread(threadId, {
    subject: "(No Subject)",
  });

  // Auto-assign the user
  await db.insert(emailThreadAssignments).values({
    threadId,
    userId,
    assignedAt: new Date(),
    assignedBy: userId, // Self-assigned via auto-assign
  });

  return true;
}

/**
 * Archive a thread
 */
export async function archiveThread(
  threadId: string,
  isArchived: boolean = true
): Promise<EmailThread | null> {
  // Ensure thread exists
  await getOrCreateEmailThread(threadId, {
    subject: "(No Subject)",
  });

  const [updated] = await db
    .update(emailThreads)
    .set({
      isArchived,
      updatedAt: new Date(),
    })
    .where(eq(emailThreads.id, threadId))
    .returning();

  return updated || null;
}

/**
 * Get thread metadata by ID
 */
export async function getThreadMetadata(
  threadId: string
): Promise<EmailThread | null> {
  const thread = await db.query.emailThreads.findFirst({
    where: eq(emailThreads.id, threadId),
  });
  return thread || null;
}

/**
 * Get category counts for sidebar badges
 */
export async function getCategoryCounts(userId?: string): Promise<{
  inbox: number;
  orders: number;
  quotes: number;
  assignedToMe: number;
  important: number;
  sent: number;
  archived: number;
}> {
  // Get all emails to find unique threads
  const allEmails = await db.query.emails.findMany({
    columns: {
      threadId: true,
      orderId: true,
      quoteId: true,
      direction: true,
    },
  });

  // Group by thread to count unique threads
  const threadMap = new Map<string, typeof allEmails[0]>();
  for (const email of allEmails) {
    if (!threadMap.has(email.threadId)) {
      threadMap.set(email.threadId, email);
    }
  }

  const threads = Array.from(threadMap.values());
  const threadIds = Array.from(threadMap.keys());

  // Count categories
  let orders = 0;
  let quotes = 0;
  let sent = 0;

  for (const thread of threads) {
    if (thread.orderId) orders++;
    if (thread.quoteId) quotes++;
    if (thread.direction === "outbound") sent++;
  }

  // Get thread metadata for important/archived
  const threadRecords = await db.query.emailThreads.findMany({
    columns: {
      id: true,
      isImportant: true,
      isArchived: true,
    },
  });

  const important = threadRecords.filter((t) => t.isImportant).length;
  const archived = threadRecords.filter((t) => t.isArchived).length;

  // Count unread threads for current user (used for inbox count and assignedToMe filtering)
  let readThreadIds = new Set<string>();
  if (userId && threadIds.length > 0) {
    const reads = await db.query.emailThreadReads.findMany({
      where: and(
        inArray(emailThreadReads.threadId, threadIds),
        eq(emailThreadReads.userId, userId)
      ),
      columns: { threadId: true },
    });
    readThreadIds = new Set(reads.map(r => r.threadId));
  }
  const unreadCount = threadIds.filter(id => !readThreadIds.has(id)).length;

  // Count assigned to current user - only count UNREAD threads assigned to me
  let assignedToMe = 0;
  if (userId) {
    const myAssignments = await db.query.emailThreadAssignments.findMany({
      where: eq(emailThreadAssignments.userId, userId),
      columns: { threadId: true },
    });
    // Filter to only count unread threads
    assignedToMe = myAssignments.filter(a => !readThreadIds.has(a.threadId)).length;
  }

  return {
    inbox: unreadCount,
    orders,
    quotes,
    assignedToMe,
    important,
    sent,
    archived,
  };
}

// ============================================
// User Queries
// ============================================

/**
 * Get all users for assignment dropdown
 */
export async function getAllUsers(): Promise<Array<{
  id: string;
  name: string | null;
  email: string;
}>> {
  return db.query.users.findMany({
    columns: {
      id: true,
      name: true,
      email: true,
    },
    orderBy: asc(users.name),
  });
}
