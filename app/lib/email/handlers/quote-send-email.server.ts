import type { User } from "@supabase/supabase-js";
import { db } from "~/lib/db";
import { quoteAttachments } from "~/lib/db/schema";
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
    const quoteId = quoteIdFromEntityId(entityId);
    const quote = await getQuote(quoteId);
    if (!quote) {
      throw new Error("Quote not found");
    }
    const customer = quote.customerId
      ? await getCustomer(quote.customerId)
      : null;
    return {
      quoteNumber: quote.quoteNumber,
      customerName: customer?.displayName ?? "Customer",
      total: quote.total ?? "0.00",
      ...(quote.stripePaymentLinkUrl
        ? { paymentLinkUrl: quote.stripePaymentLinkUrl }
        : {}),
    };
  },

  async verifyAttachmentIds(auth, entityId, attachmentIds) {
    if (attachmentIds.length === 0) return;
    const quoteId = quoteIdFromEntityId(entityId);
    const owned = await db
      .select({ id: quoteAttachments.attachmentId })
      .from(quoteAttachments)
      .where(
        and(
          eq(quoteAttachments.quoteId, quoteId),
          inArray(quoteAttachments.attachmentId, attachmentIds),
        ),
      );
    if (owned.length !== attachmentIds.length) {
      throw new Error("Invalid attachment selection");
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
