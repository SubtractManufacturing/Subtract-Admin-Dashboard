import { getCustomer } from "~/lib/customers";
import type { NormalizedAddress, ResolvedTokenMap } from "./types";
import { formatAddress } from "./formatters";

/**
 * Resolve merge tokens for a standalone customer entity send.
 * Provides customer identity and address tokens without a parent document.
 */
export async function resolveCustomerTokens(entityId: string): Promise<ResolvedTokenMap> {
  const customerId = parseInt(entityId, 10);
  if (!Number.isFinite(customerId) || customerId <= 0) {
    throw new Error(`Invalid customer id: ${entityId}`);
  }

  const customer = await getCustomer(customerId);
  if (!customer) {
    throw new Error(`Customer not found: ${customerId}`);
  }

  const tokens: ResolvedTokenMap = {};

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

  return tokens;
}
