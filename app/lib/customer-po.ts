/** Trimmed non-empty customer PO number, or null when unset. */
export function normalizePoNumber(
  poNumber: string | null | undefined,
): string | null {
  const trimmed = poNumber?.trim();
  return trimmed ? trimmed : null;
}

const ALLOWED_CUSTOMER_PO_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const ALLOWED_CUSTOMER_PO_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

/** HTML accept attribute for customer PO file inputs. */
export const CUSTOMER_PO_FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";

export function isAllowedCustomerPoFile(
  contentType: string | null | undefined,
  fileName: string,
): boolean {
  const mime = (contentType || "").toLowerCase().trim();
  if (mime && ALLOWED_CUSTOMER_PO_MIME_TYPES.has(mime)) {
    return true;
  }

  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return ALLOWED_CUSTOMER_PO_EXTENSIONS.has(lower.slice(dot));
}
