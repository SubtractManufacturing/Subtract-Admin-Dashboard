import { validateInterpolatedButtonLinksInCopy } from "~/emails/layout-definition";
import {
  coerceLegacyEmailLayoutSlug,
  getLayoutDefinition,
  isRegisteredEmailLayoutSlug,
  parseBodyCopyForLayout,
  type TemplateSlug,
} from "~/emails/registry";
import {
  interpolateLayoutCopy,
  interpolateTemplateString,
  renderEmailTemplate,
} from "~/emails/render.server";
import {
  buildEmailLayoutProps,
  collectBodyCopyStrings,
} from "~/lib/email/build-email-content.server";
import type { EmailIdentity } from "~/lib/db/schema";
import { bodyCopyFromFormData } from "~/lib/email/parse-template-body.server";
import { sendPostmarkTransactionalEmail } from "~/lib/email/postmark.server";
import { extractPlaceholderKeys } from "~/lib/email/resolve";
import { sanitizeEmailHtml } from "~/lib/email/sanitize.server";
import { wrapSimpleMarkdownPlainTextAsHtml } from "~/lib/email/simple-markdown-plain-html.server";
import type { ActorMergeSource } from "~/lib/email/resolve/actor-merge.server";
import { buildActorMergeMap } from "~/lib/email/resolve/actor-merge.server";
import { getEmailMergeFieldsMap } from "~/lib/email/templates.server";

const SUBJECT_PREVIEW_PREFIX = "[Template preview] ";

/**
 * Default merge values for layout props and button URL rules. Extend when new
 * email layouts are registered.
 */
const LAYOUT_SAMPLE_MERGE_BASE: Partial<
  Record<TemplateSlug, Record<string, string>>
> = {
  "styled-quote": {
    quoteNumber: "Q-0001-SAMPLE",
    customerName: "Sample Customer LLC",
    total: "$1,234.56",
    paymentLinkUrl: "https://example.com/sample-payment",
  },
  "example-kitchen-sink": {},
  "simple-markdown": {},
  "branded-markdown": {},
};

function replaceUnresolvedPlaceholders(s: string): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => `[${key}]`);
}

function buildSampleStringProps(
  layoutSlug: TemplateSlug,
  subjectTemplate: string,
  bodyCopy: Record<string, unknown>,
  snippetMap: Record<string, string>,
  actorMerge?: Record<string, string>,
): Record<string, string> {
  const base = { ...(LAYOUT_SAMPLE_MERGE_BASE[layoutSlug] ?? {}) };
  const stringProps: Record<string, string> = {
    ...base,
    ...snippetMap,
    ...(actorMerge ?? {}),
  };

  const referenced = extractPlaceholderKeys([
    subjectTemplate.trim(),
    ...collectBodyCopyStrings(bodyCopy),
  ]);

  for (const key of referenced) {
    const v = stringProps[key];
    if (v === undefined || v === null || v === "") {
      stringProps[key] = `[${key}]`;
    }
  }

  if (layoutSlug === "styled-quote") {
    const qs = LAYOUT_SAMPLE_MERGE_BASE["styled-quote"]!;
    for (const [k, v] of Object.entries(qs)) {
      if (!stringProps[k]?.trim()) {
        stringProps[k] = v;
      }
    }
  }

  return stringProps;
}

export type SendDraftTemplateTestEmailResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Renders the admin template form as a sample-filled email and sends it via
 * Postmark to one recipient. Does not use operational recipient_override so
 * previews always reach the signed-in user.
 */
export async function sendDraftTemplateTestEmail(params: {
  formData: FormData;
  recipientEmail: string;
  identity: EmailIdentity;
  /** When set, {{userName}} / {{userEmail}} resolve like real sends */
  actorSource?: ActorMergeSource;
}): Promise<SendDraftTemplateTestEmailResult> {
  const { formData, recipientEmail, identity, actorSource } = params;
  const layoutSlugRaw = (formData.get("layoutSlug") as string)?.trim();
  const subjectTemplate = (formData.get("subjectTemplate") as string)?.trim();
  const to = recipientEmail.trim();

  if (!to || !to.includes("@")) {
    return {
      ok: false,
      status: 400,
      error:
        "Your account has no valid email address to send the preview to.",
    };
  }

  if (!subjectTemplate) {
    return {
      ok: false,
      status: 400,
      error: "Subject is required to send a test email.",
    };
  }

  const layoutSlug = coerceLegacyEmailLayoutSlug(layoutSlugRaw);
  if (!isRegisteredEmailLayoutSlug(layoutSlug)) {
    return { ok: false, status: 400, error: "Invalid layout slug." };
  }

  const layoutDef = getLayoutDefinition(layoutSlug);
  const rawBody = bodyCopyFromFormData(formData, layoutDef);
  const bodyParsed = parseBodyCopyForLayout(layoutSlug, rawBody);
  if (!bodyParsed.ok) {
    const mergedErrors = { ...bodyParsed.errors };
    const message =
      mergedErrors._root ??
      Object.values(mergedErrors)[0] ??
      "Invalid template body fields.";
    return { ok: false, status: 400, error: message };
  }

  const mergedCopy = { ...(bodyParsed.data as Record<string, unknown>) };
  const snippetMap = await getEmailMergeFieldsMap();
  const actorMerge = actorSource
    ? buildActorMergeMap(actorSource)
    : undefined;
  const stringProps = buildSampleStringProps(
    layoutSlug,
    subjectTemplate,
    mergedCopy,
    snippetMap,
    actorMerge,
  );

  const interpolatedCopy = interpolateLayoutCopy(mergedCopy, stringProps);
  const linkPolicyError = validateInterpolatedButtonLinksInCopy(
    layoutDef,
    interpolatedCopy as Record<string, unknown>,
  );
  if (linkPolicyError) {
    return { ok: false, status: 400, error: linkPolicyError };
  }

  const props = buildEmailLayoutProps(layoutSlug, interpolatedCopy);
  let { html: rawHtml, text: textBody } = await renderEmailTemplate(
    layoutSlug,
    props,
  );

  rawHtml = interpolateTemplateString(rawHtml, stringProps);
  textBody = interpolateTemplateString(textBody, stringProps);
  if (layoutSlug === "simple-markdown") {
    rawHtml = wrapSimpleMarkdownPlainTextAsHtml(textBody);
  }
  let subjectResolved = interpolateTemplateString(subjectTemplate, stringProps);

  rawHtml = replaceUnresolvedPlaceholders(rawHtml);
  textBody = replaceUnresolvedPlaceholders(textBody);
  subjectResolved = replaceUnresolvedPlaceholders(subjectResolved);

  const fullSubject = `${SUBJECT_PREVIEW_PREFIX}${subjectResolved}`;

  try {
    await sendPostmarkTransactionalEmail({
      fromEmail: identity.fromEmail,
      fromDisplayName: identity.fromDisplayName,
      toAddresses: [to],
      replyTo: identity.replyToEmail,
      subject: fullSubject,
      htmlBody: sanitizeEmailHtml(rawHtml),
      textBody,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to send email.";
    return { ok: false, status: 502, error: msg };
  }

  return { ok: true };
}
