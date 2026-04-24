import {
  attachmentDocumentKindEnum,
  type AttachmentDocumentKind,
} from "~/lib/db/schema";

const ALLOWED = new Set<string>(attachmentDocumentKindEnum.enumValues);

/**
 * Parse checkbox values from a template form into a de-duplicated list of
 * valid attachment document kinds. Unknown values are skipped.
 */
export function parseRequiredAttachmentDocumentKindsFromForm(
  formData: FormData,
  fieldName = "requiredAttachmentDocumentKind",
): AttachmentDocumentKind[] {
  const raw = formData.getAll(fieldName) as string[];
  const out: AttachmentDocumentKind[] = [];
  for (const v of raw) {
    if (typeof v === "string" && ALLOWED.has(v)) {
      const kind = v as AttachmentDocumentKind;
      if (!out.includes(kind)) out.push(kind);
    }
  }
  return out;
}
