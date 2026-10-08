/**
 * Canonical form of an email address for Customer matching.
 *
 * Intake matching, the Customer merge tool's detection, alias writes and the
 * alias backfill all use this one function so they can never disagree about
 * whether two emails are "the same".
 *
 * It deliberately does NOT strip plus-tags or remove dots for any provider:
 * `first.last@gmail.com` and `firstlast@gmail.com` stay different mailboxes.
 *
 * Returns `null` when the input holds no usable email address.
 */

// Zero-width characters, word joiner, BOM, soft hyphen and non-breaking spaces
// (removed outright, even mid-address, rather than treated as a separator).
const INVISIBLE_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF\u00AD\u00A0\u202F\u2007]/g;
const ANGLE_WRAPPED = /<([^<>]*)>/;
const MAILTO_PREFIX = /^mailto:/i;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
const SINGLE_ADDRESS = /^[^\s@]+@[^\s@]+$/;

export function normalizeEmail(
  input: string | null | undefined,
): string | null {
  if (input == null) return null;

  // NFKC folds look-alikes (fullwidth "＠", compatibility letters) and turns
  // non-breaking spaces into plain spaces so trim() removes them.
  let value = input.replace(INVISIBLE_CHARACTERS, "").normalize("NFKC").trim();

  const wrapped = ANGLE_WRAPPED.exec(value);
  if (wrapped) value = wrapped[1].trim();

  value = value
    .replace(MAILTO_PREFIX, "")
    .trim()
    .replace(TRAILING_PUNCTUATION, "")
    .toLowerCase();

  return SINGLE_ADDRESS.test(value) ? value : null;
}
