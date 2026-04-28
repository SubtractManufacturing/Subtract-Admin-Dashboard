import {
  validateInterpolatedButtonLinksInCopy,
} from "~/emails/layout-definition";
import {
  coerceLegacyEmailLayoutSlug,
  getLayoutDefinition,
  parseBodyCopyForLayout,
  type PropsBySlug,
  type TemplateSlug,
} from "~/emails/registry";
import {
  interpolateLayoutCopy,
  interpolateTemplateString,
  renderEmailTemplate,
} from "~/emails/render.server";
import {
  getEmailMergeFieldsMap,
  resolveEmailTemplateForContext,
} from "~/lib/email/templates.server";
import { sanitizeEmailHtml } from "~/lib/email/sanitize.server";
import { getEmailSendHandler } from "~/lib/email/email-send-context-registry.server";
import {
  getEmailContextMeta,
  type EmailContextKey,
} from "~/lib/email/email-context-registry";
import { validateMergeTokens } from "~/lib/email/resolve";
import { resolveActorMergeTokens } from "~/lib/email/resolve/actor-merge.server";
import type { EmailEnqueueAuth } from "~/lib/email/handlers/quote-send-email.server";

export type BuildEmailContentResult =
  | {
      ok: true;
      subjectResolved: string;
      htmlBody: string;
      textBody: string;
      fromEmail: string;
      fromDisplayName: string | null;
      replyToEmail: string | null;
    }
  | { ok: false; status: number; error: string };

function fail(status: number, error: string): BuildEmailContentResult {
  return { ok: false, status, error };
}

export function collectBodyCopyStrings(copy: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const value of Object.values(copy)) {
    if (typeof value === "string") {
      out.push(value);
    } else if (
      value &&
      typeof value === "object" &&
      "buttonLabel" in value &&
      "link" in value
    ) {
      const btn = value as { buttonLabel: string; link: string };
      out.push(btn.buttonLabel, btn.link);
    }
  }
  return out;
}

function getPublicAssetUrl(path: string): string {
  const appUrl = process.env.PUBLIC_APP_URL?.trim();
  if (!appUrl) {
    throw new Error("PUBLIC_APP_URL must be configured to render email assets");
  }
  return `${appUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function buildEmailLayoutProps(
  layoutSlug: TemplateSlug,
  copy: unknown,
): PropsBySlug[TemplateSlug] {
  const canonical = coerceLegacyEmailLayoutSlug(layoutSlug) as TemplateSlug;
  if (canonical === "styled-quote") {
    return {
      logoUrl: getPublicAssetUrl("/subtract-logo.png"),
      copy: copy as PropsBySlug["styled-quote"]["copy"],
    };
  }
  if (canonical === "example-kitchen-sink") {
    return {
      copy: copy as PropsBySlug["example-kitchen-sink"]["copy"],
    };
  }
  const _exhaustive: never = canonical;
  return _exhaustive;
}

/**
 * Builds the resolved subject, sanitized HTML body, and plain-text body for
 * an outbound email. Used by both the enqueue path and the preview endpoint.
 *
 * `bodyCopyOverrides` is a flat map of slot id → string value. Only slots
 * whose definition has `allowPerSendEdit: true` (and are not button type) will
 * be applied; all others are silently ignored.
 */
export async function buildEmailContent({
  auth,
  contextKey,
  entityId,
  subject: subjectRaw,
  bodyCopyOverrides = {},
}: {
  auth: EmailEnqueueAuth;
  contextKey: EmailContextKey;
  entityId: string;
  subject: string;
  bodyCopyOverrides?: Record<string, string>;
}): Promise<BuildEmailContentResult> {
  let handler;
  try {
    handler = getEmailSendHandler(contextKey);
  } catch {
    return fail(500, "Email send is not configured for this context");
  }

  if (handler.prepareEmailContent) {
    try {
      await handler.prepareEmailContent(auth, entityId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(400, msg);
    }
  }

  const [templateData, mergeFields, mergeProps] = await Promise.all([
    resolveEmailTemplateForContext(contextKey),
    getEmailMergeFieldsMap(),
    handler.buildMergeProps(entityId),
  ]);

  if (!templateData) {
    const label = getEmailContextMeta(contextKey).label;
    return fail(
      400,
      `${label} is not configured. In Admin → Email, assign a template to this context.`,
    );
  }

  const fromEmail = templateData.identity.fromEmail;
  if (!fromEmail) {
    return fail(400, "Email sending is not configured (no identity found)");
  }

  const actorTokens = resolveActorMergeTokens(auth);
  const stringProps: Record<string, string> = {
    ...mergeFields,
    ...mergeProps,
    ...actorTokens,
  };

  const layoutSlug = templateData.layoutSlug;
  const bodyParse = parseBodyCopyForLayout(
    layoutSlug,
    templateData.template.bodyCopy ?? {},
  );
  if (!bodyParse.ok) {
    const detail = Object.entries(bodyParse.errors)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    return fail(
      400,
      `Email template body is invalid. Fix it in Admin → Email. ${detail}`,
    );
  }

  // Apply per-send overrides — only for slots flagged allowPerSendEdit
  const definition = getLayoutDefinition(layoutSlug);
  const mergedCopy = { ...(bodyParse.data as Record<string, unknown>) };
  for (const [slotId, value] of Object.entries(bodyCopyOverrides)) {
    const slot = definition.slots.find((s) => s.id === slotId);
    if (slot?.allowPerSendEdit && slot.type !== "button") {
      mergedCopy[slotId] = value;
    }
  }

  const subject = subjectRaw?.trim() ?? "";

  const tokenValidationError = validateMergeTokens(
    [subject, ...collectBodyCopyStrings(mergedCopy)],
    stringProps,
  );
  if (tokenValidationError) {
    return fail(400, tokenValidationError);
  }

  const interpolatedCopy = interpolateLayoutCopy(mergedCopy, stringProps);

  const linkPolicyError = validateInterpolatedButtonLinksInCopy(
    definition,
    interpolatedCopy as Record<string, unknown>,
  );
  if (linkPolicyError) {
    return fail(400, linkPolicyError);
  }

  const props = buildEmailLayoutProps(layoutSlug, interpolatedCopy);

  let { html: rawHtml, text: textBody } = await renderEmailTemplate(
    layoutSlug,
    props,
  );

  rawHtml = interpolateTemplateString(rawHtml, stringProps);
  textBody = interpolateTemplateString(textBody, stringProps);

  const subjectResolved = interpolateTemplateString(subject, stringProps);

  const unresolvedInBody = [
    ...(rawHtml.match(/\{\{\w+\}\}/g) ?? []),
    ...(textBody.match(/\{\{\w+\}\}/g) ?? []),
    ...(subjectResolved.match(/\{\{\w+\}\}/g) ?? []),
  ];
  if (unresolvedInBody.length > 0) {
    const unique = [...new Set(unresolvedInBody)];
    return fail(
      400,
      `Email contains unresolved placeholders: ${unique.join(", ")}`,
    );
  }

  return {
    ok: true,
    subjectResolved,
    htmlBody: sanitizeEmailHtml(rawHtml),
    textBody,
    fromEmail,
    fromDisplayName: templateData.identity.fromDisplayName ?? null,
    replyToEmail: templateData.identity.replyToEmail ?? null,
  };
}
