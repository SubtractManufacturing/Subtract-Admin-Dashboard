import { getOrder } from "~/lib/orders";
import { getOrderLineItems } from "~/lib/line-items";
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

/**
 * Resolve all applicable merge tokens for an order entity.
 * Only tokens with resolvable values are included in the returned map.
 */
export async function resolveOrderTokens(entityId: string): Promise<ResolvedTokenMap> {
  const orderId = parseInt(entityId, 10);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new Error(`Invalid order id: ${entityId}`);
  }

  const [order, lineItems] = await Promise.all([
    getOrder(orderId),
    getOrderLineItems(orderId),
  ]);

  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  const tokens: ResolvedTokenMap = {};

  // ── Document identifiers ────────────────────────────────────────────
  tokens.documentNumber = order.orderNumber;
  tokens.orderNumber = order.orderNumber;
  tokens.documentDate = formatDate(order.createdAt) ?? order.createdAt.toLocaleDateString();
  tokens.documentStatus = order.status;

  // ── Money ───────────────────────────────────────────────────────────
  const totalFormatted = formatCurrency(order.totalPrice);
  if (totalFormatted != null) tokens.total = totalFormatted;

  // ── Customer ────────────────────────────────────────────────────────
  const customer = order.customer;
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
  if (order.vendor?.displayName) {
    tokens.vendorName = order.vendor.displayName;
  }

  // ── Parts / Line items ───────────────────────────────────────────────
  if (lineItems.length > 0) {
    tokens.lineItemCount = String(lineItems.length);

    // Order line items may have a joined Part which carries material/tolerance/finishing
    const normalized: NormalizedPart[] = lineItems
      .filter((li) => li.name)
      .map((li) => ({
        name: li.name!,
        material: li.part?.material ?? null,
        tolerance: li.part?.tolerance ?? null,
        finishing: li.part?.finishing ?? null,
        quantity: li.quantity,
      }));

    const partNames = formatPartNames(normalized);
    if (partNames) tokens.partNames = partNames;

    const hasSpecs = normalized.some((p) => p.material || p.tolerance || p.finishing);
    if (hasSpecs) {
      const partSpecs = formatPartSpecs(normalized);
      if (partSpecs) tokens.partSpecs = partSpecs;
    }

    const partMaterials = formatPartMaterials(normalized);
    if (partMaterials) tokens.partMaterials = partMaterials;

    const partQtys = formatPartQtys(normalized);
    if (partQtys) tokens.partQtys = partQtys;
  }

  // ── Commerce / optional ─────────────────────────────────────────────
  if (order.shipDate) {
    const formatted = formatDate(order.shipDate);
    if (formatted) tokens.shipDate = formatted;
  }

  return tokens;
}
