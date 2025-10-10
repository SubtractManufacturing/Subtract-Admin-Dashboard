/**
 * Phone number formatting and validation utilities
 * Supports US phone numbers with automatic +1 (XXX) XXX-XXXX formatting
 */

/**
 * Format a phone number to +1 (XXX) XXX-XXXX
 * Accepts various input formats and normalizes them
 */
export function formatPhoneNumber(value: string): string {
  // Remove all non-digit characters
  const digits = value.replace(/\D/g, '');

  // Handle empty input
  if (!digits) return '';

  // Remove leading 1 if present (we'll add it back with +1)
  const numberDigits = digits.startsWith('1') ? digits.slice(1) : digits;

  // Format based on length
  if (numberDigits.length === 0) return '';
  if (numberDigits.length <= 3) return `+1 (${numberDigits}`;
  if (numberDigits.length <= 6) return `+1 (${numberDigits.slice(0, 3)}) ${numberDigits.slice(3)}`;

  // Full format: +1 (XXX) XXX-XXXX
  return `+1 (${numberDigits.slice(0, 3)}) ${numberDigits.slice(3, 6)}-${numberDigits.slice(6, 10)}`;
}

/**
 * Validate a US phone number
 * Returns true if the phone number has exactly 10 digits (after removing +1 and formatting)
 */
export function isValidPhoneNumber(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  const numberDigits = digits.startsWith('1') ? digits.slice(1) : digits;
  return numberDigits.length === 10;
}

/**
 * Extract raw digits from a formatted phone number
 * Returns just the 10-digit number without country code
 */
export function getPhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('1') ? digits.slice(1) : digits;
}

/**
 * Get the database-friendly format (with +1 prefix)
 * This is what should be stored in the database
 */
export function getStorageFormat(value: string): string {
  const digits = getPhoneDigits(value);
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  return value; // Return as-is if not valid
}
