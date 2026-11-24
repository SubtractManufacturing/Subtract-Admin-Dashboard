/**
 * The review list (ADR-0014 "Review before Switch > Names and types").
 *
 * One row per active old Customer or Vendor. A reviewer corrects the company,
 * contact and display name, or marks the row as right.
 *
 * A save corrects the OLD row, through today's `updateCustomer` /
 * `updateVendor`, so it writes the same Event log the Customer form writes.
 * That is the only way the cutover tooling changes an old row. The new tables
 * follow on the next Sync; a save does not run Sync.
 *
 * The save is the old app's update, so it has the old app's semantics: no
 * lock, last write wins. It is narrower than the Customer form, which rewrites
 * every field: only the fields the reviewer edited are written, and a save
 * against values that changed since the list was loaded is refused first.
 */
import { and, eq } from "drizzle-orm";

import { updateCustomer } from "../customers";
import { db } from "../db";
import { customers, cutoverReviewMarks, users, vendors } from "../db/schema";
import { updateVendor } from "../vendors";
import {
  blankToNull,
  mapLegacyNames,
  resultFingerprint,
  reviewFlags,
  type LegacyType,
} from "./mapping";
import { getCutoverStage } from "./stage.server";

export type ReviewRow = {
  type: LegacyType;
  id: number;
  displayName: string;
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  /** True while a mark exists for exactly the result this row maps to now. */
  reviewed: boolean;
  reviewedAt: Date | null;
  reviewedBy: string | null;
};

export type ReviewProgress = {
  total: number;
  reviewed: number;
  flagged: number;
  flaggedUnreviewed: number;
};

type NameColumns = {
  displayName: string;
  companyName: string | null;
  contactName: string | null;
};

const fingerprintOf = (row: NameColumns) => resultFingerprint(mapLegacyNames(row));

/**
 * Every active Customer and Vendor (the same rows as
 * scripts/sql/organizations-precheck.sql), Customers first, by display name.
 * The order does not depend on flags or marks, so a row stays where it is
 * while the reviewer works through the list.
 */
export async function loadReviewRows(): Promise<ReviewRow[]> {
  const [customerRows, vendorRows, marks] = await Promise.all([
    db
      .select({
        id: customers.id,
        displayName: customers.displayName,
        companyName: customers.companyName,
        contactName: customers.contactName,
        email: customers.email,
      })
      .from(customers)
      .where(eq(customers.isArchived, false)),
    db
      .select({
        id: vendors.id,
        displayName: vendors.displayName,
        companyName: vendors.companyName,
        contactName: vendors.contactName,
        email: vendors.email,
      })
      .from(vendors)
      .where(eq(vendors.isArchived, false)),
    db
      .select({
        legacyType: cutoverReviewMarks.legacyType,
        legacyId: cutoverReviewMarks.legacyId,
        resultFingerprint: cutoverReviewMarks.resultFingerprint,
        reviewedAt: cutoverReviewMarks.reviewedAt,
        reviewerName: users.name,
        reviewerEmail: users.email,
      })
      .from(cutoverReviewMarks)
      .leftJoin(users, eq(users.id, cutoverReviewMarks.reviewedBy)),
  ]);
  const markByKey = new Map(marks.map((mark) => [`${mark.legacyType}:${mark.legacyId}`, mark]));

  const rows: ReviewRow[] = [];
  for (const [type, list] of [
    ["customer", customerRows],
    ["vendor", vendorRows],
  ] as const) {
    const sorted = [...list].sort(
      (a, b) =>
        a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" }) ||
        a.id - b.id,
    );
    for (const row of sorted) {
      const mark = markByKey.get(`${type}:${row.id}`);
      // A mark for another result is stale: the row changed since the review.
      const reviewed = mark?.resultFingerprint === fingerprintOf(row);
      rows.push({
        type,
        ...row,
        reviewed,
        reviewedAt: reviewed ? mark!.reviewedAt : null,
        reviewedBy: reviewed ? (mark!.reviewerName ?? mark!.reviewerEmail ?? null) : null,
      });
    }
  }
  return rows;
}

export function reviewProgress(rows: ReviewRow[]): ReviewProgress {
  const flagged = rows.filter((row) => reviewFlags(row).length > 0);
  return {
    total: rows.length,
    reviewed: rows.filter((row) => row.reviewed).length,
    flagged: flagged.length,
    flaggedUnreviewed: flagged.filter((row) => !row.reviewed).length,
  };
}

export class ReviewError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

export type ReviewActor = { userId: string; email?: string | null };

export type ReviewSave = {
  type: LegacyType;
  id: number;
  /** The three fields as the reviewer saw them; a save against anything else is refused. */
  seen: NameColumns;
  /** Only the fields the reviewer edited. An empty object marks the row as right. */
  changes: Partial<NameColumns>;
};

export type ReviewSaveResult = {
  /** The old columns that were written. Empty when the row was only marked. */
  changedFields: Array<keyof NameColumns>;
  row: NameColumns;
};

const sameStored = (a: string | null, b: string | null) => (a ?? null) === (b ?? null);

/**
 * Save a review: write the edited fields to the old row (if any), then mark
 * the row as reviewed for the result it now maps to.
 */
export async function saveReview(
  input: ReviewSave,
  actor: ReviewActor,
): Promise<ReviewSaveResult> {
  // A save writes the old row only. That is right in Shadow and nowhere else:
  // once another release has switched, the old tables are no longer the ones
  // to correct.
  if ((await getCutoverStage())?.stage !== "shadow") {
    throw new ReviewError(409, "The review list saves in the Shadow stage only. Nothing was saved.");
  }

  const table = input.type === "customer" ? customers : vendors;
  const [current] = await db
    .select({
      displayName: table.displayName,
      companyName: table.companyName,
      contactName: table.contactName,
      isArchived: table.isArchived,
    })
    .from(table)
    .where(eq(table.id, input.id));
  if (!current || current.isArchived) {
    throw new ReviewError(404, "That record is archived or no longer exists. Reload the list.");
  }
  if (
    current.displayName !== input.seen.displayName ||
    !sameStored(current.companyName, input.seen.companyName) ||
    !sameStored(current.contactName, input.seen.contactName)
  ) {
    throw new ReviewError(
      409,
      "Someone changed this record since the list was loaded. Nothing was saved; the row now shows the current values.",
    );
  }

  const changes: Partial<NameColumns> = {};
  if (input.changes.displayName !== undefined) {
    const displayName = input.changes.displayName.trim();
    if (!displayName) throw new ReviewError(400, "The display name cannot be empty.");
    if (displayName !== current.displayName) changes.displayName = displayName;
  }
  for (const field of ["companyName", "contactName"] as const) {
    if (input.changes[field] === undefined) continue;
    const value = blankToNull(input.changes[field]);
    // Clearing a field that is already blank changes nothing.
    if (value === null && blankToNull(current[field]) === null) continue;
    if (value !== current[field]) changes[field] = value;
  }

  const changedFields = Object.keys(changes) as Array<keyof NameColumns>;
  if (changedFields.length > 0) {
    const eventContext = { userId: actor.userId, userEmail: actor.email ?? undefined };
    if (input.type === "customer") await updateCustomer(input.id, changes, eventContext);
    else await updateVendor(input.id, changes, eventContext);
  }

  const row: NameColumns = { ...current, ...changes };
  const fingerprint = fingerprintOf(row);
  const reviewedAt = new Date();
  await db
    .insert(cutoverReviewMarks)
    .values({
      legacyType: input.type,
      legacyId: input.id,
      resultFingerprint: fingerprint,
      reviewedBy: actor.userId,
      reviewedAt,
    })
    .onConflictDoUpdate({
      target: [cutoverReviewMarks.legacyType, cutoverReviewMarks.legacyId],
      set: { resultFingerprint: fingerprint, reviewedBy: actor.userId, reviewedAt },
    });
  return {
    changedFields,
    row: {
      displayName: row.displayName,
      companyName: row.companyName,
      contactName: row.contactName,
    },
  };
}

/** Take a reviewed mark back. Changes no old row. */
export async function clearReview(type: LegacyType, id: number): Promise<void> {
  await db
    .delete(cutoverReviewMarks)
    .where(
      and(eq(cutoverReviewMarks.legacyType, type), eq(cutoverReviewMarks.legacyId, id)),
    );
}
