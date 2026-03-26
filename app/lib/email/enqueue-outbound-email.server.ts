import { and, count, eq, gte, inArray } from "drizzle-orm";
import { db } from "~/lib/db";
import {
  attachments,
  sentEmails,
  sentEmailAttachments,
  type SentEmailEntityType,
} from "~/lib/db/schema";
import {
  getEmailMergeFieldsMap,
  getEmailSettings,
  resolveEmailTemplateForContext,
} from "~/lib/email/templates.server";
import {
  interpolateCopy,
  interpolateTemplateString,
  renderEmailTemplate,
} from "~/emails/render.server";
import { sanitizeEmailHtml } from "~/lib/email/sanitize.server";
import { getEmailSendHandler } from "~/lib/email/email-send-context-registry.server";
import {
  EMAIL_CONTEXT,
  getEmailContextMeta,
  type EmailContextKey,
} from "~/lib/email/email-context-registry";
import { sendEmailJob } from "~/lib/queue/producer.server";
import type { EmailEnqueueAuth } from "~/lib/email/handlers/quote-send-email.server";
import type { EmailTemplateProps } from "~/emails/registry";

const MAX_EMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ENTITY_THROTTLE_WINDOW_MS = 60_000;
const GLOBAL_USER_THROTTLE_MS = 5 * 60_000;
const GLOBAL_USER_THROTTLE_MAX = 10;

const ENTITY_TYPES: readonly SentEmailEntityType[] = [
  "quote",
  "order",
  "invoice",
];

function isSentEmailEntityType(x: string): x is SentEmailEntityType {
  return (ENTITY_TYPES as readonly string[]).includes(x);
}

function fail(
  status: number,
  error: string,
): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}

export type EnqueueOutboundEmailInput = {
  auth: EmailEnqueueAuth;
  contextKey: EmailContextKey;
  entityType: SentEmailEntityType;
  entityId: string;
  subject: string;
  cc: string;
  attachmentIds: string[];
  idempotencyKey: string;
};

export type EnqueueOutboundEmailResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export async function enqueueOutboundUserEmail(
  input: EnqueueOutboundEmailInput,
): Promise<EnqueueOutboundEmailResult> {
  const {
    auth,
    contextKey,
    entityType,
    entityId,
    subject: subjectRaw,
    cc: ccRaw,
    attachmentIds,
    idempotencyKey,
  } = input;

  const user = auth.user;

  if (!idempotencyKey || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
    return fail(400, "Missing or invalid idempotency key");
  }

  if (!isSentEmailEntityType(entityType)) {
    return fail(400, "Invalid entity type");
  }

  if (
    contextKey === EMAIL_CONTEXT.QUOTE_SEND &&
    entityType !== "quote"
  ) {
    return fail(400, "quote_send requires entity type quote");
  }

  const subject = subjectRaw?.trim() ?? "";
  const cc = ccRaw?.trim() ?? "";
  if (!subject || /[\r\n]/.test(subject) || /[\r\n]/.test(cc)) {
    return fail(400, "Invalid subject or header value");
  }

  let handler;
  try {
    handler = getEmailSendHandler(contextKey);
  } catch {
    return fail(500, "Email send is not configured for this context");
  }

  try {
    await handler.assertCanSend(auth, entityId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(400, msg);
  }

  try {
    await handler.verifyAttachmentIds(auth, entityId, attachmentIds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(400, msg);
  }

  if (attachmentIds.length > 0) {
    const rows = await db
      .select({ fileSize: attachments.fileSize })
      .from(attachments)
      .where(inArray(attachments.id, attachmentIds));
    const total = rows.reduce((sum, r) => sum + (r.fileSize ?? 0), 0);
    if (total > MAX_EMAIL_ATTACHMENT_BYTES) {
      return fail(
        400,
        "Total attachment size exceeds Postmark's 10 MB limit",
      );
    }
  }

  const throttleSince = new Date(Date.now() - ENTITY_THROTTLE_WINDOW_MS);
  const [entityBusy] = await db
    .select({ id: sentEmails.id })
    .from(sentEmails)
    .where(
      and(
        eq(sentEmails.entityType, entityType),
        eq(sentEmails.entityId, entityId),
        inArray(sentEmails.status, ["queued", "sending", "sent"]),
        gte(sentEmails.createdAt, throttleSince),
      ),
    )
    .limit(1);
  if (entityBusy) {
    return fail(429, "A send is already in progress. Please wait 60 seconds.");
  }

  const userThrottleSince = new Date(Date.now() - GLOBAL_USER_THROTTLE_MS);
  const [countRow] = await db
    .select({ c: count() })
    .from(sentEmails)
    .where(
      and(
        eq(sentEmails.sentByUserId, user.id),
        gte(sentEmails.createdAt, userThrottleSince),
      ),
    );
  if (Number(countRow?.c ?? 0) >= GLOBAL_USER_THROTTLE_MAX) {
    return fail(
      429,
      "Too many emails queued in a short period. Please wait a few minutes.",
    );
  }

  if (handler.beforeEnqueue) {
    try {
      await handler.beforeEnqueue(entityId, auth);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(400, msg);
    }
  }

  const [templateData, settings, mergeFields] = await Promise.all([
    resolveEmailTemplateForContext(contextKey),
    getEmailSettings(),
    getEmailMergeFieldsMap(),
  ]);

  if (!templateData) {
    const label = getEmailContextMeta(contextKey).label;
    return fail(
      400,
      `${label} is not configured. In Admin → Email, assign a template to this context.`,
    );
  }

  const fromEmail = templateData.identity.fromEmail;
  const fromDisplayName = templateData.identity.fromDisplayName || null;
  const replyToEmail = templateData.identity.replyToEmail || null;
  if (!fromEmail) {
    return fail(400, "Email sending is not configured (no identity found)");
  }

  let recipientEmail: string;
  try {
    recipientEmail = await handler.getRecipientEmail(auth, entityId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(400, msg);
  }

  let mergeProps: Record<string, string>;
  try {
    mergeProps = await handler.buildMergeProps(entityId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(400, msg);
  }

  const stringProps: Record<string, string> = {
    ...mergeFields,
    ...mergeProps,
  };

  let copy: Record<string, string> | undefined;
  if (templateData.template.bodyCopy) {
    copy = interpolateCopy(
      templateData.template.bodyCopy as Record<string, string>,
      stringProps,
    );
  }

  const props: EmailTemplateProps = {
    quoteNumber: stringProps.quoteNumber,
    customerName: stringProps.customerName,
    total: stringProps.total,
    ...(stringProps.paymentLinkUrl
      ? { paymentLinkUrl: stringProps.paymentLinkUrl }
      : {}),
    ...(copy ? { copy } : {}),
  };

  let { html: rawHtml, text: textBody } = await renderEmailTemplate(
    templateData.layoutSlug,
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

  const htmlBody = sanitizeEmailHtml(rawHtml);

  const quoteIdForRow =
    entityType === "quote" ? Number.parseInt(entityId, 10) : null;
  if (entityType === "quote" && !Number.isFinite(quoteIdForRow)) {
    return fail(400, "Invalid quote id");
  }

  let sentEmailId: number;
  try {
    sentEmailId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(sentEmails)
        .values({
          quoteId:
            entityType === "quote" && quoteIdForRow != null
              ? quoteIdForRow
              : null,
          contextKey,
          entityType,
          entityId,
          idempotencyKey,
          fromEmail,
          fromDisplayName,
          subject: subjectResolved,
          toAddresses: [recipientEmail],
          ccAddresses: cc ? [cc] : undefined,
          replyTo: replyToEmail,
          recipientOverride: settings.recipientOverride || null,
          htmlBody,
          textBody,
          source: "user",
          sentByUserId: user.id,
          sentByUserEmail: user.email ?? undefined,
          status: "queued",
        })
        .returning({ id: sentEmails.id });
      if (!row) {
        throw new Error("insert returned no row");
      }
      if (attachmentIds.length > 0) {
        await tx.insert(sentEmailAttachments).values(
          attachmentIds.map((aid) => ({
            sentEmailId: row.id,
            attachmentId: aid,
          })),
        );
      }
      return row.id;
    });
  } catch (err: unknown) {
    const dbError = err as { code?: string };
    if (dbError.code === "23505") {
      return fail(409, "Duplicate send request");
    }
    throw err;
  }

  try {
    await sendEmailJob(
      { sentEmailId },
      settings.outboundDelayMinutes,
    );
  } catch (e) {
    console.error("[enqueueOutboundUserEmail] sendEmailJob failed", e);
  }

  return { ok: true };
}
