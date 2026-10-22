import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "~/lib/db";
import { sentEmails } from "~/lib/db/schema";
import {
  EMAIL_CONTEXT,
  type EmailContextKey,
} from "~/lib/email/email-context-registry";
import { stableOutboundIdempotencyKey } from "~/lib/email/idempotency-key.server";
import {
  enqueueOutboundSystemEmail,
  enqueueOutboundUserEmail,
  type EnqueueOutboundEmailResult,
} from "~/lib/email/enqueue-outbound-email.server";
import type { EmailEnqueueAuth } from "~/lib/email/handlers/quote-send-email.server";
import { inferQuoteReceivedContextKey } from "~/lib/email/handlers/quote-received-email.server";
import { resolveEmailTemplateForContext } from "~/lib/email/templates.server";
import { isOutboundEmailEnabled } from "~/lib/featureFlags";
import { getQuote } from "~/lib/quotes";

const BLOCKING_STATUSES = [
  "queued",
  "sending",
  "sent",
  "pending_approval",
] as const;

async function hasBlockingQuoteReceivedSend(
  quoteId: number,
  contextKey: EmailContextKey,
): Promise<boolean> {
  const [row] = await db
    .select({ id: sentEmails.id })
    .from(sentEmails)
    .where(
      and(
        eq(sentEmails.entityType, "quote"),
        eq(sentEmails.entityId, String(quoteId)),
        eq(sentEmails.contextKey, contextKey),
        inArray(sentEmails.status, [...BLOCKING_STATUSES]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * RFQ import post-commit hook: silent skip on any configuration or validation failure.
 */
export async function tryEnqueueQuoteReceivedAutoEmail(
  quoteId: number,
): Promise<void> {
  if (!(await isOutboundEmailEnabled())) {
    console.info(
      `[quote_received:auto] Skipped quote ${quoteId}: outbound email disabled`,
    );
    return;
  }

  const contextKey = EMAIL_CONTEXT.QUOTE_AUTO_CREATED;
  const template = await resolveEmailTemplateForContext(contextKey);
  if (!template) {
    console.info(
      `[quote_received:auto] Skipped quote ${quoteId}: no template for ${contextKey}`,
    );
    return;
  }

  if (await hasBlockingQuoteReceivedSend(quoteId, contextKey)) {
    console.info(
      `[quote_received:auto] Skipped quote ${quoteId}: prior send exists`,
    );
    return;
  }

  const entityId = String(quoteId);
  const idempotencyKey = stableOutboundIdempotencyKey(
    contextKey,
    "quote",
    entityId,
  );

  const result = await enqueueOutboundSystemEmail({
    contextKey,
    entityType: "quote",
    entityId,
    subject: template.template.subjectTemplate,
    cc: "",
    attachmentIds: [],
    idempotencyKey,
  });

  if (!result.ok) {
    console.info(
      `[quote_received:auto] Skipped quote ${quoteId}: ${result.error}`,
    );
  }
}

export async function enqueueQuoteReceivedUserEmail(input: {
  auth: EmailEnqueueAuth;
  quoteId: number;
  contextKey?: EmailContextKey;
  idempotencyKey: string;
}): Promise<EnqueueOutboundEmailResult> {
  const quote = await getQuote(input.quoteId);
  if (!quote) {
    return { ok: false, status: 404, error: "Quote not found" };
  }
  const contextKey =
    input.contextKey ?? inferQuoteReceivedContextKey(quote);
  const template = await resolveEmailTemplateForContext(contextKey);
  if (!template) {
    return {
      ok: false,
      status: 400,
      error: "Quote received email is not configured in Admin → Email.",
    };
  }

  return enqueueOutboundUserEmail({
    auth: input.auth,
    contextKey,
    entityType: "quote",
    entityId: String(input.quoteId),
    subject: template.template.subjectTemplate,
    cc: "",
    attachmentIds: [],
    idempotencyKey: input.idempotencyKey,
  });
}

export async function getLastQuoteReceivedSend(quoteId: number, contextKey: EmailContextKey) {
  const [row] = await db
    .select({
      id: sentEmails.id,
      createdAt: sentEmails.createdAt,
      sentAt: sentEmails.sentAt,
      toAddresses: sentEmails.toAddresses,
      status: sentEmails.status,
    })
    .from(sentEmails)
    .where(
      and(
        eq(sentEmails.entityType, "quote"),
        eq(sentEmails.entityId, String(quoteId)),
        eq(sentEmails.contextKey, contextKey),
        inArray(sentEmails.status, [...BLOCKING_STATUSES]),
      ),
    )
    .orderBy(desc(sentEmails.createdAt))
    .limit(1);
  return row ?? null;
}
