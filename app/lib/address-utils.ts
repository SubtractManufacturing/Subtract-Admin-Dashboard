/**
 * Address formatting utilities for structured address data
 * Supports shipping integrations and address validation services
 */

export interface Address {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

/**
 * Format address for multi-line display (e.g., detail pages, PDFs)
 * Returns a formatted string with each address component on a new line
 */
export function formatAddress(address: Address): string {
  const parts: string[] = [];

  if (address.line1) parts.push(address.line1);
  if (address.line2) parts.push(address.line2);

  const cityStateZip = [address.city, address.state, address.postalCode]
    .filter(Boolean)
    .join(" ");

  if (cityStateZip) parts.push(cityStateZip);
  if (address.country && address.country !== "US") parts.push(address.country);

  return parts.join("\n");
}

/**
 * Format address for single line display (e.g., lists, tables, labels)
 * Returns a comma-separated string of address components
 */
export function formatAddressOneLine(address: Address): string {
  return [address.line1, address.city, address.state, address.postalCode]
    .filter(Boolean)
    .join(", ");
}

/**
 * Format address for shipping label (standardized format)
 * Returns formatted string suitable for printing on shipping labels
 */
export function formatAddressForLabel(address: Address): string {
  const parts: string[] = [];

  if (address.line1) parts.push(address.line1);
  if (address.line2) parts.push(address.line2);

  const cityStateLine =
    [address.city, address.state].filter(Boolean).join(", ") +
    (address.postalCode ? ` ${address.postalCode}` : "");

  if (cityStateLine) parts.push(cityStateLine);
  if (address.country) parts.push(address.country);

  return parts.join("\n");
}

/**
 * Validate that an address has all required fields
 * Returns true if address has line1, city, state, and postalCode
 */
export function isAddressComplete(address: Address): boolean {
  return !!(
    address.line1 &&
    address.city &&
    address.state &&
    address.postalCode
  );
}

/**
 * Check if address is empty (no fields filled)
 */
export function isAddressEmpty(address: Address): boolean {
  return !(
    address.line1 ||
    address.line2 ||
    address.city ||
    address.state ||
    address.postalCode ||
    address.country
  );
}

/**
 * Convert address object to format expected by shipping APIs
 * (e.g., UPS, FedEx, USPS, ShipStation)
 */
export function formatAddressForShippingAPI(address: Address) {
  return {
    address1: address.line1 || "",
    address2: address.line2 || "",
    city: address.city || "",
    state: address.state || "",
    postalCode: address.postalCode || "",
    country: address.country || "US",
  };
}

/**
 * Extract address from customer/vendor object
 */
export function extractBillingAddress(entity: {
  billingAddressLine1?: string | null;
  billingAddressLine2?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingPostalCode?: string | null;
  billingCountry?: string | null;
}): Address {
  return {
    line1: entity.billingAddressLine1,
    line2: entity.billingAddressLine2,
    city: entity.billingCity,
    state: entity.billingState,
    postalCode: entity.billingPostalCode,
    country: entity.billingCountry,
  };
}

/**
 * Extract shipping address from customer/vendor object
 */
export function extractShippingAddress(entity: {
  shippingAddressLine1?: string | null;
  shippingAddressLine2?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  shippingPostalCode?: string | null;
  shippingCountry?: string | null;
}): Address {
  return {
    line1: entity.shippingAddressLine1,
    line2: entity.shippingAddressLine2,
    city: entity.shippingCity,
    state: entity.shippingState,
    postalCode: entity.shippingPostalCode,
    country: entity.shippingCountry,
  };
}

/**
 * Validate US zip code format
 */
export function isValidUSZipCode(zip: string): boolean {
  const zipRegex = /^\d{5}(-\d{4})?$/;
  return zipRegex.test(zip);
}

/**
 * Validate US state code (2-letter abbreviation)
 */
export function isValidUSStateCode(state: string): boolean {
  const validStates = [
    "AL",
    "AK",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "FL",
    "GA",
    "HI",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "LA",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NY",
    "NC",
    "ND",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI",
    "WY",
    "DC",
  ];
  return validStates.includes(state.toUpperCase());
}
