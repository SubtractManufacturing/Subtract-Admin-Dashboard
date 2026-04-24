import type { User } from "@supabase/supabase-js";
import { db } from "~/lib/db";
import { attachments, quoteAttachments } from "~/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getQuote } from "~/lib/quotes";
import { getCustomer } from "~/lib/customers";
import {
  validateQuoteCanBeSent,
  ensureQuoteStripePaymentLink,
  transitionQuoteToSent,
} from "~/lib/quotes.server";
import type { QuoteEventContext } from "~/lib/quotes";
import { createEvent } from "~/lib/events";
import type { EmailSendContextHandler } from "~/lib/email/email-send-context-registry.server";
import { resolveQuoteTokens } from "~/lib/email/resolve/quote.server";
import { resolveEmailTemplateForContext } from "~/lib/email/templates.server";
import { EMAIL_CONTEXT } from "~/lib/email/email-context-registry";

export type EmailEnqueueAuth = {
  user: User;
  userDetails: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  };
};

function quoteIdFromEntityId(entityId: string): number {
  const id = Number.parseInt(entityId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Invalid quote id");
  }
  return id;
}

function eventContextFromAuth(auth: EmailEnqueueAuth): QuoteEventContext {
  return {
    userId: auth.user.id,
    userEmail: auth.user.email ?? auth.userDetails.name ?? undefined,
  };
}

export const quoteSendEmailHandler: EmailSendContextHandler = {
  async assertCanSend(auth, entityId) {
    const quoteId = quoteIdFromEntityId(entityId);
    const quote = await getQuote(quoteId);
    if (!quote) {
      throw new Error("Quote not found");
    }
    if (!["RFQ", "Draft"].includes(quote.status)) {
      throw new Error("Quote must be RFQ or Draft to send");
    }
    const preflight = await validateQuoteCanBeSent(quoteId);
    if (!preflight.success) {
      throw new Error(`Cannot send email: ${preflight.error}`);
    }
    const customer = quote.customerId
      ? await getCustomer(quote.customerId)
      : null;
    if (!customer?.email) {
      throw new Error("Customer has no email address");
    }
  },

  async getRecipientEmail(_auth, entityId) {
    const quoteId = quoteIdFromEntityId(entityId);
    const quote = await getQuote(quoteId);
    if (!quote) {
      throw new Error("Quote not found");
    }
    const customer = quote.customerId
      ? await getCustomer(quote.customerId)
      : null;
    const email = customer?.email?.trim();
    if (!email) {
      throw new Error("Customer has no email address");
    }
    return email;
  },

  async buildMergeProps(entityId) {
    return resolveQuoteTokens(entityId);
  },

  async verifyAttachmentIds(_auth, entityId, attachmentIds) {
    const quoteId = quoteIdFromEntityId(entityId);

    const resolved = await resolveEmailTemplateForContext(EMAIL_CONTEXT.QUOTE_SEND);
    if (!resolved) {
      throw new Error(
        "No active email template is configured for sending quotes. Set one in Admin → Email.",
      );
    }

    const required =
      resolved.template.requiredAttachmentDocumentKinds ?? [];
    if (required.length > 0 && attachmentIds.length === 0) {
      throw new Error(
        "This email template requires at least one attachment. Add the required file(s) before sending.",
      );
    }
    if (required.length === 0 && attachmentIds.length === 0) {
      return;
    }

    // Verify all attachment IDs belong to this quote and fetch documentKind
    const owned = await db
      .select({
        id: quoteAttachments.attachmentId,
        documentKind: attachments.documentKind,
      })
      .from(quoteAttachments)
      .leftJoin(
        attachments,
        eq(quoteAttachments.attachmentId, attachments.id),
      )
      .where(
        and(
          eq(quoteAttachments.quoteId, quoteId),
          inArray(quoteAttachments.attachmentId, attachmentIds),
        ),
      );

    if (owned.length !== attachmentIds.length) {
      throw new Error("Invalid attachment selection");
    }

    for (const kind of required) {
      const hasKind = owned.some((r) => r.documentKind === kind);
      if (!hasKind) {
        const label =
          kind === "quote"
            ? "quote PDF"
            : kind === "purchase_order"
              ? "purchase order"
              : kind.replace(/_/g, " ");
        throw new Error(
          `This email template requires a ${label} attachment. Add one before sending.`,
        );
      }
    }
  },

  async beforeEnqueue(entityId, auth) {
    const quoteId = quoteIdFromEntityId(entityId);
    const result = await ensureQuoteStripePaymentLink(
      quoteId,
      eventContextFromAuth(auth),
    );
    if (!result.success) {
      throw new Error(result.error);
    }
  },

  async afterPendingApprovalQueued(row, auth) {
    const quoteId = row.quoteId ?? quoteIdFromEntityId(row.entityId);
    const before = await getQuote(quoteId);
    if (!before) {
      throw new Error("Quote not found");
    }
    const previousStatus = before.status;
    if (previousStatus !== "RFQ" && previousStatus !== "Draft") {
      throw new Error("Quote is not in a sendable state for approval flow");
    }

    const ctx = eventContextFromAuth(auth);
    const transition = await transitionQuoteToSent(quoteId, ctx);
    if (!transition.success) {
      throw new Error(
        transition.error ?? "Could not move quote to Sent (approval queue)",
      );
    }

    await createEvent({
      entityType: "quote",
      entityId: quoteId.toString(),
      eventType: "quote_email_awaiting_approval",
      eventCategory: "communication",
      title: "Quote email pending approval",
      description:
        "The quote is marked as sent; outbound email is waiting for approval before delivery.",
      metadata: {
        sentEmailId: row.id,
        previousStatus,
      },
      userId: row.sentByUserId ?? undefined,
      userEmail: row.sentByUserEmail ?? undefined,
    });
  },

  async afterSent(row) {
    const quoteId =
      row.quoteId ?? quoteIdFromEntityId(row.entityId);
    const messageId = row.providerMessageId ?? "";

    await createEvent({
      entityType: "quote",
      entityId: quoteId.toString(),
      eventType: "quote_email_sent",
      eventCategory: "communication",
      title: "Quote email sent",
      description: `Email delivered to ${row.toAddresses.join(", ")}`,
      metadata: {
        sentEmailId: row.id,
        providerMessageId: messageId,
      },
      userId: row.sentByUserId ?? undefined,
      userEmail: row.sentByUserEmail ?? undefined,
    });

    const quote = await getQuote(quoteId);
    if (quote?.status === "Sent") {
      // Already moved when the message was queued for approval; delivery event only.
      return;
    }

    const result = await transitionQuoteToSent(quoteId, {
      userId: row.sentByUserId ?? undefined,
      userEmail: row.sentByUserEmail ?? undefined,
    });
    if (!result.success) {
      console.error(
        `[afterSent:quote_send] Quote ${quoteId} transition failed: ${result.error}`,
      );
    }
  },
};
