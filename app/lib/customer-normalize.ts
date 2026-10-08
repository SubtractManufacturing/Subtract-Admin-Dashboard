/**
 * Normalizers for the non-email signals used to spot possible duplicate
 * Customers. Emails use `normalizeEmail` from `./email-normalize`.
 */

export function normalizeCompanyName(value: string | null): string | null {
  const normalized = (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return normalized || null;
}

export function normalizePhoneDigits(value: string | null): string | null {
  const digits = (value ?? "").replace(/\D+/g, "");
  return digits || null;
}

export function normalizeContactName(value: string | null): string | null {
  const normalized = (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}
