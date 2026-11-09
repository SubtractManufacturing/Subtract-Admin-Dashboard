/**
 * Everything the "Send email" modal on a Quote or Order needs before it opens:
 * whether a template is configured, the subject it will start with, which
 * attachment kinds it requires, and which body slots a person may edit per send.
 *
 * Replaces two ~70-line loader blocks that differed only in context key and the
 * variables available to the subject template. Template lookup, merge fields,
 * layout registry and interpolation sit behind {@link SendComposerPorts}.
 */
import type { AttachmentDocumentKind } from "~/lib/db/schema";
import type { EmailContextKey } from "~/lib/email/email-context-registry";

export type EditableSlot = {
  id: string;
  type: "plainText" | "markdown";
  adminLabel: string;
  templateValue: string;
};

export type SendComposerState = {
  ready: boolean;
  defaultSubject: string | null;
  requiredAttachmentDocumentKinds: AttachmentDocumentKind[];
  editableSlots: EditableSlot[];
};

export type LayoutSlot = {
  id: string;
  type: string;
  adminLabel: string;
  allowPerSendEdit?: boolean;
};

type MaybePromise<T> = T | Promise<T>;

export type SendComposerPorts = {
  resolveTemplate(contextKey: EmailContextKey): Promise<{
    layoutSlug: string;
    template: {
      subjectTemplate: string;
      bodyCopy?: unknown;
      requiredAttachmentDocumentKinds?: AttachmentDocumentKind[] | null;
    };
  } | null>;
  mergeFields(): Promise<Record<string, string>>;
  interpolate(template: string, vars: Record<string, string>): MaybePromise<string>;
  layoutSlots(layoutSlug: string): MaybePromise<readonly LayoutSlot[]>;
  parseBodyCopy(
    layoutSlug: string,
    raw: unknown,
  ): MaybePromise<{ ok: true; data: unknown } | { ok: false }>;
};

export const NOT_READY: SendComposerState = {
  ready: false,
  defaultSubject: null,
  requiredAttachmentDocumentKinds: [],
  editableSlots: [],
};

export async function loadSendComposer(
  ports: SendComposerPorts,
  input: {
    contextKey: EmailContextKey;
    /** `userName` / `userEmail` for the signed-in person. */
    actorMerge: Record<string, string>;
    /** Entity-specific subject variables (numbers, customer name, total). */
    subjectVars: Record<string, string>;
  },
): Promise<SendComposerState> {
  const [resolved, mergeFields] = await Promise.all([
    ports.resolveTemplate(input.contextKey),
    ports.mergeFields(),
  ]);
  if (!resolved) return NOT_READY;

  const defaultSubject = await ports.interpolate(resolved.template.subjectTemplate, {
    ...mergeFields,
    ...input.actorMerge,
    ...input.subjectVars,
  });

  const body = await ports.parseBodyCopy(
    resolved.layoutSlug,
    resolved.template.bodyCopy ?? {},
  );

  const editableSlots: EditableSlot[] = body.ok
    ? (await ports.layoutSlots(resolved.layoutSlug))
        .filter((slot) => !!slot.allowPerSendEdit && slot.type !== "button")
        .map((slot) => ({
          id: slot.id,
          type: slot.type as EditableSlot["type"],
          adminLabel: slot.adminLabel,
          templateValue: String((body.data as Record<string, unknown>)[slot.id] ?? ""),
        }))
    : [];

  return {
    ready: true,
    defaultSubject,
    requiredAttachmentDocumentKinds:
      resolved.template.requiredAttachmentDocumentKinds ?? [],
    editableSlots,
  };
}
