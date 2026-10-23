import { getQuote } from "~/lib/quotes";
import { createEvent } from "~/lib/events";
import type { EmailSendContextHandler } from "~/lib/email/email-send-context-registry.server";
import { resolveQuoteTokens } from "~/lib/email/resolve/quote.server";
import {
  EMAIL_CONTEXT,
  type EmailContextKey,
} from "~/lib/email/email-context-registry";
import type { SentEmail } from "~/lib/db/schema";
import type { EmailEnqueueAuth } from "~/lib/email/handlers/quote-send-email.server";
import { parseQuoteCreationMetadata } from "~/lib/quotes/creation-metadata";

function quoteIdFromEntityId(entityId: string): number {
  const id = Number.parseInt(entityId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Invalid quote id");
  }
  return id;
}

async function assertQuoteReadyForReceivedEmail(entityId: string) {
  const quoteId = quoteIdFromEntityId(entityId);
  const quote = await getQuote(quoteId);
  if (!quote) {
    throw new Error("Quote not found");
  }
  if (quote.isArchived) {
    throw new Error("Cannot send email for an archived quote");
  }
}

/**
 * Shared by quote_auto_created and quote_manual_created: the contexts differ
 * only by template (and To template), not by send behavior.
 */
const quoteReceivedEmailHandler: EmailSendContextHandler = {
  async assertCanSend(_auth, entityId) {
    await assertQuoteReadyForReceivedEmail(entityId);
  },

  async getRecipientEmail(_auth, entityId) {
    await assertQuoteReadyForReceivedEmail(entityId);
    const quote = await getQuote(quoteIdFromEntityId(entityId));
    const email = quote?.customer?.email?.trim();
    if (!email) {
      throw new Error("Customer has no email address");
    }
    return email;
  },

  async buildMergeProps(entityId) {
    return resolveQuoteTokens(entityId);
  },

  async verifyAttachmentIds() {
    // Quote received acknowledgments do not attach files in v1.
  },

  async afterPendingApprovalQueued(row, auth) {
    await recordQuoteReceivedTimelineEvent(
      row,
      "quote_received_email_awaiting_approval",
      auth,
    );
  },

  async afterSent(row) {
    await recordQuoteReceivedTimelineEvent(row, "quote_received_email_sent");
  },
};

async function recordQuoteReceivedTimelineEvent(
  row: SentEmail,
  eventType:
    | "quote_received_email_sent"
    | "quote_received_email_awaiting_approval",
  auth?: EmailEnqueueAuth,
) {
  const quoteId =
    row.quoteId ?? quoteIdFromEntityId(row.entityId);
  const recipient = row.toAddresses[0] ?? "";
  await createEvent({
    entityType: "quote",
    entityId: quoteId.toString(),
    eventType,
    eventCategory: "communication",
    title:
      eventType === "quote_received_email_sent"
        ? "Quote received email sent"
        : "Quote received email pending approval",
    description:
      eventType === "quote_received_email_sent"
        ? `Acknowledgment delivered to ${recipient}`
        : `Acknowledgment queued for approval (to ${recipient})`,
    metadata: {
      sentEmailId: row.id,
      contextKey: row.contextKey,
      recipient,
    },
    userId: auth?.user.id ?? row.sentByUserId ?? undefined,
    userEmail:
      auth?.user.email ??
      auth?.userDetails.email ??
      row.sentByUserEmail ??
      undefined,
  });
}

export const quoteAutoCreatedEmailHandler = quoteReceivedEmailHandler;
export const quoteManualCreatedEmailHandler = quoteReceivedEmailHandler;

export function inferQuoteReceivedContextKey(quote: {
  creationMetadata?: unknown;
}): EmailContextKey {
  return parseQuoteCreationMetadata(quote.creationMetadata)
    ? EMAIL_CONTEXT.QUOTE_AUTO_CREATED
    : EMAIL_CONTEXT.QUOTE_MANUAL_CREATED;
}
