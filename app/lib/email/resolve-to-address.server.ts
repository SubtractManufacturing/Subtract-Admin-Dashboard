import { interpolateTemplateString } from "~/emails/render.server";
import { validateMergeTokens } from "~/lib/email/resolve";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Accept `{{customerEmail}}` or a bare catalog key like `customerEmail`. */
export function normalizeToTemplateString(toTemplate: string): string {
  const trimmed = toTemplate.trim();
  if (!trimmed || trimmed.includes("{{")) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(trimmed)) {
    return `{{${trimmed}}}`;
  }
  return trimmed;
}

export function resolveToAddressFromTemplate(
  toTemplate: string,
  stringProps: Record<string, string>,
): { ok: true; address: string } | { ok: false; error: string } {
  const trimmed = normalizeToTemplateString(toTemplate);
  if (!trimmed) {
    return { ok: false, error: "Email template To field is empty." };
  }
  const tokenError = validateMergeTokens([trimmed], stringProps);
  if (tokenError) {
    return { ok: false, error: tokenError };
  }
  const resolved = interpolateTemplateString(trimmed, stringProps).trim();
  if (!resolved) {
    return { ok: false, error: "Email To address resolved to an empty value." };
  }
  if (!EMAIL_RE.test(resolved)) {
    return {
      ok: false,
      error: `Email To address is not a valid email: ${resolved}`,
    };
  }
  return { ok: true, address: resolved };
}
