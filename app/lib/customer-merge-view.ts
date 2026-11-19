/**
 * Client-safe shapes and helpers for the merge tool (ADR-0013). Merging works
 * on Organizations; a Customer or Vendor is one of an Organization's accounts.
 * Loader data is JSON, so dates arrive as strings; everything here accepts
 * either form.
 */
import type { OrganizationKind } from "./organizations/types";

export type DateLike = string | Date;

export type OrganizationSummaryView = {
  /** Organization id. */
  id: string;
  kind: OrganizationKind;
  displayName: string;
  /** The Organization name for a business, null for an individual. */
  companyName: string | null;
  customerAccountId: string | null;
  vendorAccountId: string | null;
  /** Primary Contact. */
  contactName: string | null;
  email: string | null;
  phone: string | null;
  contacts: Array<{ id: string; name: string | null; email: string | null }>;
  /** Normalized emails of every Contact, aliases included. */
  emails: string[];
  quoteCount: number;
  orderCount: number;
  lastActivityAt: DateLike | null;
};

/** @deprecated use OrganizationSummaryView */
export type CustomerSummaryView = OrganizationSummaryView;

export type DuplicateReasonKind = "email" | "domain" | "company" | "phone" | "name";

export type DuplicateReasonView = {
  kind: DuplicateReasonKind;
  value: string;
};

export type DuplicatePairView = {
  a: OrganizationSummaryView;
  b: OrganizationSummaryView;
  reasons: DuplicateReasonView[];
  score: number;
};

/** The match filters, in display order. */
export const MATCH_KINDS: readonly DuplicateReasonKind[] = [
  "email",
  "domain",
  "phone",
  "company",
  "name",
];

/** Read the `match` filter from a URL, ignoring anything unrecognised. */
export function parseMatchKinds(
  value: string | null | undefined,
): DuplicateReasonKind[] {
  const wanted = new Set((value ?? "").split(",").map((part) => part.trim()));
  return MATCH_KINDS.filter((kind) => wanted.has(kind));
}

/** Which Organizations the merge tool suggests: those with this kind of account. */
export type MergeScope = "customers" | "vendors" | "all";

export function parseMergeScope(value: string | null | undefined): MergeScope {
  return value === "vendors" || value === "all" ? value : "customers";
}

export type MergeFieldChoice = "survivor" | "merged";

export type FieldConflictView = {
  field: string;
  label: string;
  survivorValue: string;
  mergedValue: string;
  requiresExplicitChoice: boolean;
  defaultChoice: MergeFieldChoice;
};

export type AccountMoveView = {
  type: "customer" | "vendor";
  /** "fold": records move into the survivor's account; "move": the account moves over. */
  mode: "fold" | "move" | "none";
};

export type MergePreviewView = {
  survivor: OrganizationSummaryView;
  merged: OrganizationSummaryView;
  counts: {
    quotes: number;
    orders: number;
    parts: number;
    vendorQuotes: number;
    vendorOrders: number;
    contacts: number;
    addresses: number;
    attachments: number;
    communications: number;
    notes: number;
    events: number;
  };
  /** Contacts already on both Organizations; their links collapse into one. */
  contactsAlreadyLinked: number;
  attachmentsAlreadyLinked: number;
  accounts: AccountMoveView[];
  retainedEmails: string[];
  conflicts: FieldConflictView[];
  autoFills: Array<{ field: string; label: string; value: string }>;
  survivorUpdatedAt: DateLike;
  mergedUpdatedAt: DateLike;
};

export const REASON_LABELS: Record<DuplicateReasonKind, string> = {
  email: "Same email",
  domain: "Same email domain",
  company: "Same company",
  phone: "Same phone",
  name: "Same contact name",
};

/** Short names for the filter chips. */
export const MATCH_FILTER_LABELS: Record<DuplicateReasonKind, string> = {
  email: "Email",
  domain: "Domain",
  phone: "Phone",
  company: "Company",
  name: "Contact name",
};

/** Where staff see an Organization: its Customer page, else its Vendor page. */
export function organizationHref(summary: {
  customerAccountId: string | null;
  vendorAccountId: string | null;
}): string | null {
  if (summary.customerAccountId) return `/customers/${summary.customerAccountId}`;
  if (summary.vendorAccountId) return `/vendors/${summary.vendorAccountId}`;
  return null;
}

/**
 * Link into the merge tool with candidate Customers pre-loaded. Ids are
 * customer account uuids; legacy integer ids from resolved Action Items are
 * accepted too and resolved by the merge route.
 */
export function customerMergeHref(candidateCustomerIds: string[]): string {
  const ids = [...new Set(candidateCustomerIds)].filter((id) => /^[0-9a-f-]{36}$|^\d+$/i.test(id));
  return ids.length > 0
    ? `/customers/merge?ids=${ids.join(",")}`
    : "/customers/merge";
}

/**
 * Candidate customer account ids of a Customer match review. Active items hold
 * uuids (the backfill rewrote them); resolved items from before ADR-0013 hold
 * integer Customer ids, returned as strings for the legacy redirect.
 */
export function candidateIdsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string[] {
  const raw = metadata?.candidateCustomerIds;
  const ids = (Array.isArray(raw) ? raw : [])
    .map((value) => (typeof value === "number" && Number.isInteger(value) ? String(value) : value))
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  // Items created before ADR-0012 stored the Customer intake created separately
  // from the pre-existing matches. Review has to include that Customer too.
  const created = metadata?.createdCustomerId;
  const createdId =
    typeof created === "number" && Number.isInteger(created)
      ? String(created)
      : typeof created === "string"
        ? created
        : null;
  if (createdId && !ids.includes(createdId)) ids.push(createdId);
  return ids;
}

function timeOf(value: DateLike | null): number {
  return value === null ? 0 : new Date(value).getTime();
}

/** The Organization with the most history (Quotes + Orders), then most recent activity, then a stable order. */
export function defaultSurvivorId(organizations: OrganizationSummaryView[]): string {
  return [...organizations].sort(
    (a, b) =>
      b.quoteCount + b.orderCount - (a.quoteCount + a.orderCount) ||
      timeOf(b.lastActivityAt) - timeOf(a.lastActivityAt) ||
      // A business is the likelier survivor when an individual joins it.
      (a.kind === b.kind ? 0 : a.kind === "business" ? -1 : 1) ||
      a.id.localeCompare(b.id),
  )[0].id;
}
