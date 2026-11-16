/**
 * Policy: when may a Quote be accepted (converted to an Order)?
 *
 * Both "Mark as Accepted" and "Receive PO" gate on this; previously the checks
 * were pasted into each handler.
 */

type PartLike = {
  conversionStatus: string | null;
  partFileUrl: string | null;
};

export type QuoteForAcceptance = {
  total: string | null;
  lineItems?: ReadonlyArray<unknown> | null;
  parts?: ReadonlyArray<PartLike> | null;
};

/** A part whose mesh is still being (or about to be) converted. */
export function hasPendingMeshConversion(part: PartLike): boolean {
  return (
    part.conversionStatus === "in_progress" ||
    part.conversionStatus === "queued" ||
    (part.conversionStatus === "pending" && !!part.partFileUrl)
  );
}

/** Human-readable reasons this quote cannot be accepted; empty when it can. */
export function validateQuoteForAcceptance(quote: QuoteForAcceptance): string[] {
  const errors: string[] = [];

  if (parseFloat(quote.total || "0") <= 0) {
    errors.push(
      "Quote must have a valid total greater than $0. Please add pricing to line items.",
    );
  }

  if (!quote.lineItems || quote.lineItems.length === 0) {
    errors.push("Quote must have at least one line item.");
  }

  const pending = (quote.parts ?? []).filter(hasPendingMeshConversion);
  if (pending.length > 0) {
    errors.push(
      `Cannot accept quote while ${pending.length} part(s) have pending mesh conversions.`,
    );
  }

  return errors;
}
