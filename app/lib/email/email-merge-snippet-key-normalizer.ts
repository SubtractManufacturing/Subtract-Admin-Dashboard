/**
 * Normalize admin-entered merge snippet keys so they remain consistent while typing
 * and still pass server-side validation.
 *
 * This helper is intentionally pure and safe to run in both:
 * - client input handlers (`onChange`), and
 * - server action handlers before validation/persistence.
 *
 * Rules:
 * 1) Convert whitespace and hyphen runs to a single underscore (`_`)
 * 2) Strip unsupported characters (keep only ASCII letters, digits, underscore)
 * 3) Lowercase letters unless the previous output character is a letter
 *    (permits camelCase while normalizing new word starts)
 * 4) Strip leading digits/underscores so a non-empty result can match `^[a-zA-Z]\w*$`
 *
 * Examples:
 * - "Button Text"   -> "button_text"
 * - "Sign Off"      -> "sign_off"
 * - "myURLChunk"    -> "myURLChunk"
 * - "9 New Field!"  -> "new_field"
 */
export function normalizeEmailSnippetKeyInput(raw: string): string {
  let normalized = raw.replace(/[\s-]+/g, "_");
  normalized = normalized.replace(/[^A-Za-z0-9_]/g, "");

  let output = "";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (/[a-zA-Z]/.test(char)) {
      const previous = output[output.length - 1];
      const previousIsLetter =
        previous !== undefined && /[a-zA-Z]/.test(previous);
      output += previousIsLetter ? char : char.toLowerCase();
    } else {
      output += char;
    }
  }

  return output.replace(/^[\d_]+/, "");
}
