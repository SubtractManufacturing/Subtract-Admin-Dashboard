export type Carrier = {
  code: string;
  label: string;
  abbr: string;
  badgeClass: string;
};

export const CARRIERS: Carrier[] = [
  { code: "USPS", label: "USPS",    abbr: "USPS",  badgeClass: "bg-blue-700 text-white" },
  { code: "UPS",  label: "UPS",     abbr: "UPS",   badgeClass: "bg-amber-700 text-white" },
  { code: "FEDEX",label: "FedEx",   abbr: "FedEx", badgeClass: "bg-purple-700 text-white" },
  { code: "DHL",  label: "DHL",     abbr: "DHL",   badgeClass: "bg-yellow-400 text-gray-900" },
  { code: "ONTRAC",label: "OnTrac", abbr: "OnTrac",badgeClass: "bg-orange-600 text-white" },
  { code: "OTHER",label: "Other...",abbr: "Other", badgeClass: "bg-gray-500 text-white" },
];

export function getCarrierLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return CARRIERS.find((c) => c.code === code)?.label ?? null;
}

export function getCarrier(code: string | null | undefined): Carrier | null {
  if (!code) return null;
  return CARRIERS.find((c) => c.code === code) ?? null;
}

export function getTrackingUrl(
  code: string | null | undefined,
  trackingNumber: string,
): string | null {
  const tn = encodeURIComponent(trackingNumber.trim());
  switch (code) {
    case "USPS":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tn}`;
    case "UPS":
      return `https://www.ups.com/track?tracknum=${tn}`;
    case "FEDEX":
      return `https://www.fedex.com/fedextrack/?trknbr=${tn}`;
    case "DHL":
      return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${tn}`;
    case "ONTRAC":
      return `https://www.ontrac.com/tracking/?number=${tn}`;
    default:
      return null;
  }
}

/**
 * Attempts to identify a carrier from a tracking number using well-known format patterns.
 * Returns the carrier code (e.g. "UPS") or null when the format is ambiguous/unrecognized.
 * Never returns "OTHER" — that code is reserved for user-entered custom carriers.
 */
export function detectCarrier(trackingNumber: string): string | null {
  const tn = trackingNumber.trim().toUpperCase();
  if (!tn) return null;

  // UPS: starts with 1Z, followed by 16 alphanumeric chars (18 total)
  if (/^1Z[A-Z0-9]{16}$/.test(tn)) return "UPS";

  // UPS: also 12-digit format used for some UPS Mail Innovations
  if (/^[0-9]{12}$/.test(tn)) {
    // 12-digit is also FedEx Ground — not reliable enough, skip
  }

  // USPS: service-indicator prefixes followed by 18–20 digits
  if (/^(94|93|92|91|90)\d{18,20}$/.test(tn)) return "USPS";

  // USPS: international format AA000000000US (2 letters + 9 digits + 2 letters = 13 chars)
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(tn)) return "USPS";

  // FedEx Express: 12-digit (no leading 96)
  if (/^\d{12}$/.test(tn)) return "FEDEX";

  // FedEx Express: 15-digit
  if (/^\d{15}$/.test(tn)) return "FEDEX";

  // FedEx SmartPost / Ground Economy: 22-digit starting with 96 (check before 22-digit USPS)
  if (/^96\d{20}$/.test(tn)) return "FEDEX";

  // DHL Express: JD prefix + 18 digits
  if (/^JD\d{18}$/.test(tn)) return "DHL";

  // DHL Express: 10-digit numeric
  if (/^\d{10}$/.test(tn)) return "DHL";

  // OnTrac: C prefix + 14 digits
  if (/^C\d{14}$/.test(tn)) return "ONTRAC";

  return null;
}
