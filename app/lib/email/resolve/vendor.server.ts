import { getVendor } from "~/lib/vendors";
import type { NormalizedAddress, ResolvedTokenMap } from "./types";
import { formatAddress } from "./formatters";

/**
 * Resolve merge tokens for a standalone vendor entity send.
 */
export async function resolveVendorTokens(entityId: string): Promise<ResolvedTokenMap> {
  const vendorId = parseInt(entityId, 10);
  if (!Number.isFinite(vendorId) || vendorId <= 0) {
    throw new Error(`Invalid vendor id: ${entityId}`);
  }

  const vendor = await getVendor(vendorId);
  if (!vendor) {
    throw new Error(`Vendor not found: ${vendorId}`);
  }

  const tokens: ResolvedTokenMap = {};

  tokens.vendorName = vendor.displayName;

  if (vendor.companyName?.trim()) tokens.customerCompanyName = vendor.companyName;
  if (vendor.email?.trim()) tokens.customerEmail = vendor.email;
  if (vendor.phone?.trim()) tokens.customerPhone = vendor.phone;
  if (vendor.paymentTerms?.trim()) tokens.paymentTerms = vendor.paymentTerms;

  const billing = formatAddress({
    company: vendor.companyName,
    line1: vendor.billingAddressLine1,
    line2: vendor.billingAddressLine2,
    city: vendor.billingCity,
    state: vendor.billingState,
    postalCode: vendor.billingPostalCode,
  } satisfies NormalizedAddress);
  if (billing) tokens.billingAddress = billing;

  const shipping = formatAddress({
    company: vendor.companyName,
    line1: vendor.shippingAddressLine1,
    line2: vendor.shippingAddressLine2,
    city: vendor.shippingCity,
    state: vendor.shippingState,
    postalCode: vendor.shippingPostalCode,
  } satisfies NormalizedAddress);
  if (shipping) tokens.shippingAddress = shipping;

  return tokens;
}
