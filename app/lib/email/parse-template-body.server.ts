import type { EmailLayoutDefinition } from "~/emails/layout-definition";
import {
  getLayoutDefinition,
  parseBodyCopyForLayout,
  type TemplateSlug,
} from "~/emails/registry";

/**
 * Reads slot values from a Remix FormData submission into a raw copy object
 * keyed by slot id. Button slots expect two form fields per slot:
 *   slot.<id>.buttonLabel  and  slot.<id>.link
 * All other slot types use a single field:
 *   slot.<id>
 */
export function bodyCopyFromFormData(
  formData: FormData,
  definition: EmailLayoutDefinition,
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const slot of definition.slots) {
    if (slot.type === "button") {
      obj[slot.id] = {
        buttonLabel: String(formData.get(`slot.${slot.id}.buttonLabel`) ?? ""),
        link: String(formData.get(`slot.${slot.id}.link`) ?? ""),
      };
    } else {
      obj[slot.id] = String(formData.get(`slot.${slot.id}`) ?? "");
    }
  }
  return obj;
}

export type ParseTemplateBodyResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; slotErrors: Record<string, string> };

/**
 * Parse and validate the body-copy section of a template save/update form
 * submission.  Returns typed slot data on success or a merged error object
 * (keyed by slot id) that can be forwarded directly to the client as
 * `slotErrors`.
 */
export function parseTemplateBodyFromFormData(
  formData: FormData,
  layoutSlug: string,
): ParseTemplateBodyResult {
  if (!layoutSlug) {
    return { ok: false, error: "Invalid layout slug.", slotErrors: {} };
  }

  // Narrow to a registered slug before calling getLayoutDefinition
  let typedSlug: TemplateSlug;
  try {
    const definition = getLayoutDefinition(layoutSlug as TemplateSlug);
    typedSlug = layoutSlug as TemplateSlug;
    const rawBody = bodyCopyFromFormData(formData, definition);
    const bodyParsed = parseBodyCopyForLayout(typedSlug, rawBody);
    if (!bodyParsed.ok) {
      const mergedErrors = { ...bodyParsed.errors };
      const message =
        mergedErrors._root ??
        Object.values(mergedErrors)[0] ??
        "Invalid template body fields.";
      delete mergedErrors._root;
      return { ok: false, error: message, slotErrors: mergedErrors };
    }
    return { ok: true, data: bodyParsed.data as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Invalid layout slug.", slotErrors: {} };
  }
}
