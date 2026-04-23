import { db } from "./db";
import { sentEmails } from "./db/schema";
import { desc, sql } from "drizzle-orm";
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
>;

export interface SentEmailStatusCounts {
  inFlight: number;
  sent: number;
  failed: number;
  bounced: number;
  total: number;
}

export async function listRecentSentEmails({
  limit = 50,
  offset = 0,
}: {
  limit?: number;
  offset?: number;
} = {}): Promise<SentEmailListItem[]> {
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
    })
    .from(sentEmails)
    .orderBy(desc(sentEmails.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getSentEmailStatusCounts(): Promise<SentEmailStatusCounts> {
  const rows = await db
    .select({
      status: sentEmails.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(sentEmails)
    .groupBy(sentEmails.status);

  const map = Object.fromEntries(rows.map((r) => [r.status, r.count]));

  const inFlight = (map["queued"] ?? 0) + (map["sending"] ?? 0);
  const sent = map["sent"] ?? 0;
  const failed = map["failed"] ?? 0;
  const bounced = map["bounced"] ?? 0;

  return {
    inFlight,
    sent,
    failed,
    bounced,
    total: inFlight + sent + failed + bounced,
  };
}
