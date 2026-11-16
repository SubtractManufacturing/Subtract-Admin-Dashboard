/**
 * Presentation rules for the Quote detail page: which sections are editable at
 * which status, how a status is coloured, how dates and money read. Pure and
 * client-safe, so the rules are testable without rendering the page.
 */

/** Statuses after which the quote is read-only or partly locked. */
const CLOSED: readonly string[] = ["Accepted", "Rejected", "Expired"];
const SENT_OR_CLOSED: readonly string[] = ["Sent", ...CLOSED];

export type QuoteSectionLocks = {
  notes: boolean;
  attachments: boolean;
  /** Line items and prices. */
  pricing: boolean;
  /** Customer, vendor, validity, delivery. */
  details: boolean;
};

/**
 * Sent quotes keep notes and attachments open (people still add context) but
 * freeze what the customer was quoted; closed quotes freeze everything.
 */
export function quoteSectionLocks(status: string): QuoteSectionLocks {
  return {
    notes: CLOSED.includes(status),
    attachments: CLOSED.includes(status),
    pricing: SENT_OR_CLOSED.includes(status),
    details: SENT_OR_CLOSED.includes(status),
  };
}

const GRAY = "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300";

export function quoteStatusBadgeClasses(status: string): string {
  switch (status.toLowerCase()) {
    case "draft":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    case "sent":
      return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300";
    case "accepted":
      return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
    case "rejected":
      return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
    case "expired":
      return "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300";
    default:
      // RFQ, Dropped and anything unknown
      return GRAY;
  }
}

/** "$12.50"; empty reads as "$0.00". */
export function formatQuoteMoney(amount: string | null | undefined): string {
  if (!amount) return "$0.00";
  return `$${parseFloat(amount).toFixed(2)}`;
}

const asDate = (date: Date | string) => (typeof date === "string" ? new Date(date) : date);

export function formatQuoteDate(date: Date | string | null | undefined): string {
  if (!date) return "--";
  return asDate(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

export function formatQuoteDateTime(date: Date | string | null | undefined): string {
  if (!date) return "--";
  return asDate(date).toLocaleString("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Whole days until `date` (rounded up); negative once past; null when unset. */
export function daysUntil(
  date: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!date) return null;
  return Math.ceil((asDate(date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

type SortableLine = { id: number; quotePartId?: string | null };

/** Part-backed lines first, additional services after; stable by id within each group. */
export function sortQuoteLineItems<T extends SortableLine>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const aGroup = a.quotePartId ? 0 : 1;
    const bGroup = b.quotePartId ? 0 : 1;
    return aGroup !== bGroup ? aGroup - bGroup : a.id - b.id;
  });
}

/** Sum of line totals as a two-decimal string; unparseable totals count as 0. */
export function sumLineTotals(items: ReadonlyArray<{ totalPrice: string | null }>): string {
  return items.reduce((sum, item) => sum + (parseFloat(item.totalPrice ?? "") || 0), 0).toFixed(2);
}

export type QuoteReceivedLastSend = {
  createdAt: string;
  sentAt: string | null;
  to: string;
  status: string;
};

/** Explains why re-sending the "we received your request" email needs confirming. */
export function describeQuoteReceivedResendPrompt(lastSend: QuoteReceivedLastSend): string {
  const recipient = lastSend.to;
  if (lastSend.sentAt) {
    return `An acknowledgment was already sent on ${new Date(lastSend.sentAt).toLocaleString()} to ${recipient}.`;
  }
  const requestedAt = new Date(lastSend.createdAt).toLocaleString();
  if (lastSend.status === "pending_approval") {
    return `A send was requested on ${requestedAt} to ${recipient} and is awaiting approval.`;
  }
  if (lastSend.status === "queued" || lastSend.status === "sending") {
    return `A send was requested on ${requestedAt} to ${recipient} and is still in progress.`;
  }
  return `A prior acknowledgment request on ${requestedAt} to ${recipient} is recorded.`;
}
