/**
 * Client-safe shapes and helpers for the Customer merge tool. Loader data is
 * JSON, so dates arrive as strings; everything here accepts either form.
 */

export type DateLike = string | Date;

export type CustomerSummaryView = {
  id: number;
  displayName: string;
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  emails: string[];
  quoteCount: number;
  orderCount: number;
  lastActivityAt: DateLike | null;
};

export type DuplicateReasonKind = "email" | "company" | "phone" | "name";

export type DuplicateReasonView = {
  kind: DuplicateReasonKind;
  value: string;
};

/** Order-independent key for a pair of Customer ids. */
export const customerPairKey = (a: number, b: number) =>
  a < b ? `${a}:${b}` : `${b}:${a}`;

export type DismissedPairView = {
  lowCustomerId: number;
  highCustomerId: number;
  dismissedBy: string | null;
  dismissedByLabel: string | null;
  dismissedAt: DateLike;
};

export type DuplicateGroupView = {
  customers: CustomerSummaryView[];
  reasons: DuplicateReasonView[];
  dismissedPairs: DismissedPairView[];
};

export type MergeFieldChoice = "survivor" | "merged";

export type FieldConflictView = {
  field: string;
  label: string;
  survivorValue: string;
  mergedValue: string;
  requiresExplicitChoice: boolean;
};

export type MergePreviewView = {
  survivor: CustomerSummaryView;
  merged: CustomerSummaryView;
  counts: {
    quotes: number;
    orders: number;
    parts: number;
    attachments: number;
    communications: number;
    notes: number;
  };
  attachmentsAlreadyLinked: number;
  retainedEmails: string[];
  conflicts: FieldConflictView[];
  autoFills: Array<{ field: string; label: string; value: string }>;
  survivorUpdatedAt: DateLike;
  mergedUpdatedAt: DateLike;
};

export const REASON_LABELS: Record<DuplicateReasonView["kind"], string> = {
  email: "Same email",
  company: "Same company",
  phone: "Same phone",
  name: "Same contact name",
};

/** Link into the merge tool with candidate Customers pre-loaded. */
export function customerMergeHref(candidateCustomerIds: number[]): string {
  const ids = [...new Set(candidateCustomerIds)].filter(Number.isInteger);
  return ids.length > 0
    ? `/customers/merge?ids=${ids.join(",")}`
    : "/customers/merge";
}

export function candidateIdsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): number[] {
  const raw = metadata?.candidateCustomerIds;
  return Array.isArray(raw)
    ? raw.filter((value): value is number => Number.isInteger(value))
    : [];
}

function timeOf(value: DateLike | null): number {
  return value === null ? 0 : new Date(value).getTime();
}

/** The Customer with the most history (Quotes + Orders), then most recent activity, then oldest. */
export function defaultSurvivorId(customers: CustomerSummaryView[]): number {
  return [...customers].sort(
    (a, b) =>
      b.quoteCount + b.orderCount - (a.quoteCount + a.orderCount) ||
      timeOf(b.lastActivityAt) - timeOf(a.lastActivityAt) ||
      a.id - b.id,
  )[0].id;
}
