import { getQuote } from "~/lib/quotes";
import type { NormalizedAddress, NormalizedPart, ResolvedTokenMap } from "./types";
import {
  formatCurrency,
  formatDate,
  formatAddress,
  formatPartNames,
  formatPartSpecs,
} from "./formatters";

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

    // QuotePart uses `finish` (not `finishing`) — normalize to the DTO field name
    const normalized: NormalizedPart[] = parts.map((p) => ({
      name: p.partName,
      material: p.material,
      tolerance: p.tolerance,
      finishing: p.finish,
    }));

    const partNames = formatPartNames(normalized);
    if (partNames) tokens.partNames = partNames;

    const partSpecs = formatPartSpecs(normalized);
    if (partSpecs) tokens.partSpecs = partSpecs;
  } else if (lineItems.length > 0) {
    // Fallback: use line item names when no linked QuoteParts exist
    const nameItems: NormalizedPart[] = lineItems
      .filter((li) => li.name)
      .map((li) => ({ name: li.name! }));
    const partNames = formatPartNames(nameItems);
    if (partNames) tokens.partNames = partNames;
  }

  // ── Commerce / optional ─────────────────────────────────────────────
  if (quote.stripePaymentLinkUrl?.trim()) {
    tokens.paymentLinkUrl = quote.stripePaymentLinkUrl;
  }

  if (quote.validUntil) {
    const formatted = formatDate(quote.validUntil);
    if (formatted) tokens.validUntil = formatted;
  }

  return tokens;
}
