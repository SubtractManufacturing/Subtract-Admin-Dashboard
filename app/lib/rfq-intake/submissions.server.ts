import { count, desc, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import {
  quotes,
  rfqImportLedger,
  type UserRole,
} from "../db/schema";
import { retryRfqImport } from "./retry.server";
import type { ImportStatus } from "./types";

export const RFQ_SUBMISSIONS_PAGE_SIZE = 25;

export type RfqSubmissionStatusGroup =
  | "all"
  | "in_progress"
  | "failed"
  | "completed";

export type RfqSubmissionActor = {
  role: UserRole;
};

export class RfqSubmissionCommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RfqSubmissionCommandError";
  }
}

const IN_PROGRESS_STATUSES: ImportStatus[] = [
  "pending",
  "processing",
  "retry_scheduled",
  "cleanup_pending",
];

export function parseRfqSubmissionStatusGroup(
  value: string | null,
): RfqSubmissionStatusGroup {
  if (
    value === "in_progress" ||
    value === "failed" ||
    value === "completed"
  ) {
    return value;
  }
  return "all";
}

function statusFilter(group: RfqSubmissionStatusGroup) {
  switch (group) {
    case "in_progress":
      return inArray(rfqImportLedger.status, IN_PROGRESS_STATUSES);
    case "failed":
      return eq(rfqImportLedger.status, "permanent_failure");
    case "completed":
      return eq(rfqImportLedger.status, "completed");
    case "all":
      return undefined;
  }
}

export function canRetryRfqSubmission(status: ImportStatus): boolean {
  return status === "retry_scheduled" || status === "permanent_failure";
}

export async function listRfqIntakeSubmissions(input: {
  status: RfqSubmissionStatusGroup;
  page: number;
}) {
  const page = Math.max(1, Math.floor(input.page) || 1);
  const where = statusFilter(input.status);
  const [countRow] = await db
    .select({ total: count() })
    .from(rfqImportLedger)
    .where(where);
  const total = Number(countRow?.total ?? 0);
  const totalPages = Math.max(
    1,
    Math.ceil(total / RFQ_SUBMISSIONS_PAGE_SIZE),
  );
  const currentPage = Math.min(page, totalPages);
  const rows = await db
    .select({
      receiptKey: rfqImportLedger.receiptKey,
      receiptNumber: rfqImportLedger.receiptNumber,
      sessionId: rfqImportLedger.sessionId,
      status: rfqImportLedger.status,
      attemptCount: rfqImportLedger.attemptCount,
      nextAttemptAt: rfqImportLedger.nextAttemptAt,
      errorDetail: rfqImportLedger.errorDetail,
      receivedAt: rfqImportLedger.createdAt,
      quoteId: rfqImportLedger.quoteId,
      quoteNumber: quotes.quoteNumber,
    })
    .from(rfqImportLedger)
    .leftJoin(quotes, eq(rfqImportLedger.quoteId, quotes.id))
    .where(where)
    .orderBy(desc(rfqImportLedger.createdAt), desc(rfqImportLedger.id))
    .limit(RFQ_SUBMISSIONS_PAGE_SIZE)
    .offset((currentPage - 1) * RFQ_SUBMISSIONS_PAGE_SIZE);

  return {
    rows: rows.map((row) => ({
      ...row,
      displayId: row.receiptNumber ?? row.sessionId,
      canRetry: canRetryRfqSubmission(row.status),
    })),
    total,
    page: currentPage,
    totalPages,
  };
}

export async function retryRfqIntakeSubmission(
  receiptKey: string,
  actor: RfqSubmissionActor,
) {
  if (actor.role !== "Admin" && actor.role !== "Dev") {
    throw new RfqSubmissionCommandError("Admin or Dev role required", 403);
  }

  const [submission] = await db
    .select({ status: rfqImportLedger.status })
    .from(rfqImportLedger)
    .where(eq(rfqImportLedger.receiptKey, receiptKey))
    .limit(1);
  if (!submission) {
    throw new RfqSubmissionCommandError("RFQ intake submission not found", 404);
  }
  if (!canRetryRfqSubmission(submission.status)) {
    throw new RfqSubmissionCommandError(
      "RFQ intake submission is not waiting or failed",
      409,
    );
  }
  if (!(await retryRfqImport(receiptKey))) {
    throw new RfqSubmissionCommandError("RFQ intake submission not found", 404);
  }
}
