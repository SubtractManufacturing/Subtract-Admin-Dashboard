import { db } from "./db";
import { orders, sentEmails } from "./db/schema";
import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { SentEmail } from "./db/schema";
import type { EmailContextKey } from "./email/email-context-registry";

/** Blocks a new send while one of these rows exists for (order, context). */
const ORDER_CONTEXT_BLOCKING_STATUSES = [
  "queued",
  "sending",
  "pending_approval",
  "sent",
  "bounced",
] as const;

/**
 * True if a non-terminal send already exists for this order and context
 * (in flight, delivered, or bounced). Failed / rejected allows retry.
 */
export async function hasBlockingOrderContextSend(
  orderEntityId: string,
  contextKey: EmailContextKey,
): Promise<boolean> {
  const [row] = await db
    .select({ id: sentEmails.id })
    .from(sentEmails)
    .where(
      and(
        eq(sentEmails.entityType, "order"),
        eq(sentEmails.entityId, orderEntityId),
        eq(sentEmails.contextKey, contextKey),
        inArray(sentEmails.status, [...ORDER_CONTEXT_BLOCKING_STATUSES]),
      ),
    )
    .limit(1);
  return row != null;
}

type SentEmailListItemBase = Pick<
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

export type SentEmailListItem = SentEmailListItemBase & {
  /** For `entityType === "order"`, batched lookup for `/orders/{orderNumber}` links */
  orderNumber: string | null;
};

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

/** Pending approval, failed delivery, or bounced — used for SERP Email nav badge. */
export function outboundAttentionCountFromStatusCounts(
  counts: SentEmailStatusCounts,
): number {
  return counts.pendingApproval + counts.failed + counts.bounced;
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

async function attachOrderNumbersToSentEmailRows(
  rows: SentEmailListItemBase[],
): Promise<SentEmailListItem[]> {
  const orderIds = new Set<number>();
  for (const r of rows) {
    if (r.entityType !== "order") continue;
    const id = Number.parseInt(r.entityId, 10);
    if (Number.isFinite(id) && id > 0) orderIds.add(id);
  }
  if (orderIds.size === 0) {
    return rows.map((r) => ({ ...r, orderNumber: null }));
  }
  const idList = [...orderIds];
  const found = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber })
    .from(orders)
    .where(inArray(orders.id, idList));
  const map = new Map(found.map((o) => [o.id, o.orderNumber]));

  return rows.map((r) => {
    if (r.entityType !== "order") {
      return { ...r, orderNumber: null };
    }
    const id = Number.parseInt(r.entityId, 10);
    const orderNumber =
      Number.isFinite(id) && id > 0 ? (map.get(id) ?? null) : null;
    return { ...r, orderNumber };
  });
}

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
  const rows = await filtered
    .orderBy(desc(sentEmails.createdAt))
    .limit(limit)
    .offset(offset);
  return attachOrderNumbersToSentEmailRows(rows);
}

export async function listPendingApprovalEmails(
  minCreatedAt: Date | null = null,
): Promise<SentEmailListItem[]> {
  const statusCond = eq(sentEmails.status, "pending_approval");
  const whereClause = minCreatedAt
    ? and(statusCond, gte(sentEmails.createdAt, minCreatedAt))
    : statusCond;

  const rows = await db
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
  return attachOrderNumbersToSentEmailRows(rows);
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
