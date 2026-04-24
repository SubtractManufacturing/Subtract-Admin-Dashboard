import { db } from "./db";
import { sentEmails } from "./db/schema";
import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";
import type { SentEmail } from "./db/schema";

export type SentEmailListItem = Pick<
  SentEmail,
  | "id"
  | "status"
  | "subject"
  | "toAddresses"
  | "ccAddresses"
  | "fromEmail"
  | "fromDisplayName"
  | "htmlBody"
  | "textBody"
  | "errorMessage"
  | "contextKey"
  | "entityType"
  | "entityId"
  | "quoteId"
  | "source"
  | "sentByUserEmail"
  | "createdAt"
  | "sentAt"
  | "approvedByUserId"
  | "approvedAt"
  | "rejectedByUserId"
  | "rejectedAt"
>;

export interface SentEmailStatusCounts {
  inFlight: number;
  /** queued + sending */
  pendingApproval: number;
  sent: number;
  failed: number;
  bounced: number;
  rejected: number;
  total: number;
}

const listSelectShape = {
  id: sentEmails.id,
  status: sentEmails.status,
  subject: sentEmails.subject,
  toAddresses: sentEmails.toAddresses,
  ccAddresses: sentEmails.ccAddresses,
  fromEmail: sentEmails.fromEmail,
  fromDisplayName: sentEmails.fromDisplayName,
  htmlBody: sentEmails.htmlBody,
  textBody: sentEmails.textBody,
  errorMessage: sentEmails.errorMessage,
  contextKey: sentEmails.contextKey,
  entityType: sentEmails.entityType,
  entityId: sentEmails.entityId,
  quoteId: sentEmails.quoteId,
  source: sentEmails.source,
  sentByUserEmail: sentEmails.sentByUserEmail,
  createdAt: sentEmails.createdAt,
  sentAt: sentEmails.sentAt,
  approvedByUserId: sentEmails.approvedByUserId,
  approvedAt: sentEmails.approvedAt,
  rejectedByUserId: sentEmails.rejectedByUserId,
  rejectedAt: sentEmails.rejectedAt,
} as const;

export async function countSentEmailsInListWindow(
  minCreatedAt: Date | null,
): Promise<number> {
  const rows = minCreatedAt
    ? await db
        .select({ c: count() })
        .from(sentEmails)
        .where(gte(sentEmails.createdAt, minCreatedAt))
    : await db.select({ c: count() }).from(sentEmails);
  return Number(rows[0]?.c ?? 0);
}

export async function listRecentSentEmails({
  limit = 50,
  offset = 0,
  minCreatedAt = null,
}: {
  limit?: number;
  offset?: number;
  /** When set, only rows with created_at >= this instant are returned. */
  minCreatedAt?: Date | null;
} = {}): Promise<SentEmailListItem[]> {
  const base = db.select(listSelectShape).from(sentEmails);
  const filtered = minCreatedAt
    ? base.where(gte(sentEmails.createdAt, minCreatedAt))
    : base;
  return filtered
    .orderBy(desc(sentEmails.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function listPendingApprovalEmails(
  minCreatedAt: Date | null = null,
): Promise<SentEmailListItem[]> {
  const statusCond = eq(sentEmails.status, "pending_approval");
  const whereClause = minCreatedAt
    ? and(statusCond, gte(sentEmails.createdAt, minCreatedAt))
    : statusCond;

  return db
    .select({
      id: sentEmails.id,
      status: sentEmails.status,
      subject: sentEmails.subject,
      toAddresses: sentEmails.toAddresses,
      ccAddresses: sentEmails.ccAddresses,
      fromEmail: sentEmails.fromEmail,
      fromDisplayName: sentEmails.fromDisplayName,
      htmlBody: sentEmails.htmlBody,
      textBody: sentEmails.textBody,
      errorMessage: sentEmails.errorMessage,
      contextKey: sentEmails.contextKey,
      entityType: sentEmails.entityType,
      entityId: sentEmails.entityId,
      quoteId: sentEmails.quoteId,
      source: sentEmails.source,
      sentByUserEmail: sentEmails.sentByUserEmail,
      createdAt: sentEmails.createdAt,
      sentAt: sentEmails.sentAt,
      approvedByUserId: sentEmails.approvedByUserId,
      approvedAt: sentEmails.approvedAt,
      rejectedByUserId: sentEmails.rejectedByUserId,
      rejectedAt: sentEmails.rejectedAt,
    })
    .from(sentEmails)
    .where(whereClause)
    .orderBy(asc(sentEmails.createdAt));
}

export async function getSentEmailStatusCounts(
  minCreatedAt: Date | null = null,
): Promise<SentEmailStatusCounts> {
  const base = db
    .select({
      status: sentEmails.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(sentEmails);
  const filtered = minCreatedAt
    ? base.where(gte(sentEmails.createdAt, minCreatedAt))
    : base;
  const rows = await filtered.groupBy(sentEmails.status);

  const map = Object.fromEntries(rows.map((r) => [r.status, r.count]));

  const inFlight = (map["queued"] ?? 0) + (map["sending"] ?? 0);
  const pendingApproval = map["pending_approval"] ?? 0;
  const sent = map["sent"] ?? 0;
  const failed = map["failed"] ?? 0;
  const bounced = map["bounced"] ?? 0;
  const rejected = map["rejected"] ?? 0;

  return {
    inFlight,
    pendingApproval,
    sent,
    failed,
    bounced,
    rejected,
    total: inFlight + pendingApproval + sent + failed + bounced + rejected,
  };
}
