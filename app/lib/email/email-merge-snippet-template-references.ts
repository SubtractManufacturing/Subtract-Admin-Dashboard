import type { EmailTemplate } from "~/lib/db/schema";

/**
 * Returns true when a text fragment contains the exact merge placeholder token
 * for a snippet key, e.g. `{{buttonText}}`.
 *
 * Notes:
 * - This intentionally performs exact token matching.
 * - Snippet keys in this codebase are normalized/validated to letters, digits,
 *   and underscores, so direct interpolation into the regex is safe.
 */
export function textHasExactSnippetPlaceholder(
  text: string,
  key: string,
): boolean {
  return new RegExp(`\\{\\{${key}\\}\\}`).test(text);
}

function bodyFieldReferencesSnippet(
  value: unknown,
  key: string,
): boolean {
  if (typeof value === "string") {
    return textHasExactSnippetPlaceholder(value, key);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    for (const v of Object.values(o)) {
      if (typeof v === "string" && textHasExactSnippetPlaceholder(v, key)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Finds active templates that currently reference a merge snippet key.
 *
 * We check:
 * - `subjectTemplate`, and
 * - string values and nested button strings inside `bodyCopy`
 *
 * This helper is shared by:
 * - UI logic (to lock snippet renaming and show where it is used), and
 * - server actions (to block delete/rename when references still exist).
 */
export function templatesReferencingSnippetKey(
  templateList: EmailTemplate[],
  key: string,
): EmailTemplate[] {
  return templateList.filter((template) => {
    if (textHasExactSnippetPlaceholder(template.subjectTemplate, key)) {
      return true;
    }

    const bodyCopy = template.bodyCopy as Record<string, unknown> | null;
    if (!bodyCopy || typeof bodyCopy !== "object") {
      return false;
    }
    for (const value of Object.values(bodyCopy)) {
      if (bodyFieldReferencesSnippet(value, key)) {
        return true;
      }
    }

    return false;
  });
}
