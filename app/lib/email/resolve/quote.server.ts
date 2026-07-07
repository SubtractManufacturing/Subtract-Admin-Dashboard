import { getQuote } from "~/lib/quotes";
import type { NormalizedAddress, NormalizedPart, ResolvedTokenMap } from "./types";
import {
  formatCurrency,
  formatDate,
  formatAddress,
  formatPartNames,
  formatPartSpecs,
  formatPartMaterials,
  formatPartQtys,
} from "./formatters";
import {
  addBusinessDays,
  formatLeadTimeBusinessDays,
  startOfTodayInAppTz,
} from "~/lib/business-days";
import { formatDateRangeForDisplay } from "~/lib/date-display";

/**
 * Resolve all applicable merge tokens for a quote entity.
 *
 * Only tokens with resolvable values are included in the returned map.
 * An absent key means "not available for this quote" — fail-closed validation
 * in the enqueue path will reject the send if a template references an absent key.
 */
export async function resolveQuoteTokens(entityId: string): Promise<ResolvedTokenMap> {
  const quoteId = parseInt(entityId, 10);
  if (!Number.isFinite(quoteId) || quoteId <= 0) {
    throw new Error(`Invalid quote id: ${entityId}`);
  }

  const quote = await getQuote(quoteId);
  if (!quote) {
    throw new Error(`Quote not found: ${quoteId}`);
  }

  const tokens: ResolvedTokenMap = {};

  // ── Document identifiers ────────────────────────────────────────────
  tokens.documentNumber = quote.quoteNumber;
  tokens.quoteNumber = quote.quoteNumber;
  tokens.documentDate = formatDate(quote.createdAt) ?? quote.createdAt.toLocaleDateString();
  tokens.documentStatus = quote.status;

  // ── Money ───────────────────────────────────────────────────────────
  const totalFormatted = formatCurrency(quote.total);
  if (totalFormatted != null) tokens.total = totalFormatted;

  const subtotalFormatted = formatCurrency(quote.subtotal);
  if (subtotalFormatted != null) tokens.subtotal = subtotalFormatted;

  // ── Customer ────────────────────────────────────────────────────────
  const customer = quote.customer;
  if (customer) {
    tokens.customerName = customer.displayName;

    if (customer.companyName?.trim()) tokens.customerCompanyName = customer.companyName;
    if (customer.email?.trim()) tokens.customerEmail = customer.email;
    if (customer.phone?.trim()) tokens.customerPhone = customer.phone;
    if (customer.paymentTerms?.trim()) tokens.paymentTerms = customer.paymentTerms;

    const billing = formatAddress({
      company: customer.companyName,
      line1: customer.billingAddressLine1,
      line2: customer.billingAddressLine2,
      city: customer.billingCity,
      state: customer.billingState,
      postalCode: customer.billingPostalCode,
    } satisfies NormalizedAddress);
    if (billing) tokens.billingAddress = billing;

    const shipping = formatAddress({
      company: customer.companyName,
      line1: customer.shippingAddressLine1,
      line2: customer.shippingAddressLine2,
      city: customer.shippingCity,
      state: customer.shippingState,
      postalCode: customer.shippingPostalCode,
    } satisfies NormalizedAddress);
    if (shipping) tokens.shippingAddress = shipping;
  }

  // ── Vendor ──────────────────────────────────────────────────────────
  if (quote.vendor?.displayName) {
    tokens.vendorName = quote.vendor.displayName;
  }

  // ── Parts / Line items ───────────────────────────────────────────────
  const parts = quote.parts ?? [];
  const lineItems = quote.lineItems ?? [];

  if (lineItems.length > 0) {
    tokens.lineItemCount = String(lineItems.length);
  }

  if (parts.length > 0) {
    tokens.partCount = String(parts.length);

    // QuotePart uses `finish` (not `finishing`) — normalize to the DTO field name.
    // Quantity: sum line items linked to each quote part (same part may appear on multiple lines).
    const normalized: NormalizedPart[] = parts.map((p) => {
      const linkedLineItems = lineItems.filter((li) => li.quotePartId === p.id);
      const displayName =
        linkedLineItems.find((li) => li.name?.trim())?.name?.trim() || p.partName;
      const qtySum = linkedLineItems.reduce((sum, li) => sum + li.quantity, 0);
      return {
        // Customer-facing name: line item label wins; quote_parts.part_name is the
        // underlying CAD identity shown as "Part: ..." subtext and is not renamed.
        name: displayName,
        material: p.material,
        tolerance: p.tolerance,
        finishing: p.finish,
        quantity: qtySum,
      };
    });

    const partNames = formatPartNames(normalized);
    if (partNames) tokens.partNames = partNames;

    const partSpecs = formatPartSpecs(normalized);
    if (partSpecs) tokens.partSpecs = partSpecs;

    const partMaterials = formatPartMaterials(normalized);
    if (partMaterials) tokens.partMaterials = partMaterials;

    const partQtys = formatPartQtys(normalized);
    if (partQtys) tokens.partQtys = partQtys;
  } else if (lineItems.length > 0) {
    // Fallback: use line item names when no linked QuoteParts exist (no part-level material).
    const nameItems: NormalizedPart[] = lineItems
      .filter((li) => li.name)
      .map((li) => ({ name: li.name!, quantity: li.quantity }));
    const partNames = formatPartNames(nameItems);
    if (partNames) tokens.partNames = partNames;

    const partQtys = formatPartQtys(nameItems);
    if (partQtys) tokens.partQtys = partQtys;
  }

  // ── Commerce / optional ─────────────────────────────────────────────
  if (quote.stripePaymentLinkUrl?.trim()) {
    tokens.paymentLinkUrl = quote.stripePaymentLinkUrl;
  }

  if (quote.validUntil) {
    const formatted = formatDate(quote.validUntil);
    if (formatted) tokens.validUntil = formatted;
  }

  const min = quote.leadTimeBusinessDaysMin;
  const max = quote.leadTimeBusinessDaysMax;
  if (min != null && max != null && min >= 0 && max >= min) {
    const today = startOfTodayInAppTz();
    const start = addBusinessDays(today, min);
    const end = addBusinessDays(today, max);
    const rangeFormatted = formatDateRangeForDisplay(start, end, {
      includeTimeZoneLabel: false,
    });
    if (rangeFormatted) tokens.estimatedDeliveryDate = rangeFormatted;
    tokens.leadTimeBusinessDays = formatLeadTimeBusinessDays(min, max);
  }

  return tokens;
}
