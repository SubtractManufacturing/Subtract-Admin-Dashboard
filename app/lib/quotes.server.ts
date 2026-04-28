import { and, desc, eq, sql } from "drizzle-orm";
import { getQuote, updateQuote, type QuoteEventContext } from "./quotes";
import { db } from "./db";
import { eventLogs } from "./db/schema";
import { isStripePaymentLinksEnabled } from "./featureFlags";
import { getEventsByEntity } from "./events";

export type TransitionResult =
  | { success: true }
  | { success: false; error: string };

export async function validateQuoteCanBeSent(
  quoteId: number
): Promise<TransitionResult> {
  const quote = await getQuote(quoteId);
  if (!quote) return { success: false, error: "Quote not found" };

  const stripeOn = await isStripePaymentLinksEnabled();
  if (!stripeOn) {
    return { success: true };
  }

  const { isStripeConfigured } = await import("~/lib/stripe.server");
  if (!isStripeConfigured()) {
    return { success: false, error: "Stripe is not configured" };
  }

  const sendTotal = parseFloat(quote.total || "0");
  if (sendTotal <= 0) {
    return { success: false, error: "Quote total must be greater than $0" };
  }

  return { success: true };
}

/** Creates or reuses an active Stripe payment link without changing quote status (e.g. before rendering send-email). */
export async function ensureQuoteStripePaymentLink(
  quoteId: number,
  eventContext: QuoteEventContext
): Promise<TransitionResult> {
  const stripeOn = await isStripePaymentLinksEnabled();
  if (!stripeOn) {
    return { success: true };
  }

  const preflight = await validateQuoteCanBeSent(quoteId);
  if (!preflight.success) {
    return preflight;
  }

  const quote = await getQuote(quoteId);
  if (!quote) return { success: false, error: "Quote not found" };

  const { isStripeConfigured, createQuotePaymentLink } = await import(
    "~/lib/stripe.server"
  );
  if (!isStripeConfigured()) {
    return { success: false, error: "Stripe is not configured" };
  }

  if (
    quote.stripePaymentLinkId &&
    quote.stripePaymentLinkActive &&
    quote.stripePaymentLinkUrl
  ) {
    return { success: true };
  }

  let paymentLink: { url: string; id: string };
  try {
    paymentLink = await createQuotePaymentLink({
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      totalDollars: quote.total!,
      customerId: quote.customerId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }

  const updated = await updateQuote(
    quoteId,
    {
      stripePaymentLinkUrl: paymentLink.url,
      stripePaymentLinkId: paymentLink.id,
      stripePaymentLinkActive: true,
      rejectionReason: null,
    },
    eventContext
  );
  if (!updated) {
    return { success: false, error: "Failed to save payment link" };
  }
  return { success: true };
}

export async function transitionQuoteToSent(
  quoteId: number,
  eventContext: QuoteEventContext
): Promise<TransitionResult> {
  const preflight = await validateQuoteCanBeSent(quoteId);
  if (!preflight.success) {
    return preflight;
  }

  const quote = await getQuote(quoteId);
  if (!quote) return { success: false, error: "Quote not found" };

  const stripeOn = await isStripePaymentLinksEnabled();
  if (stripeOn) {
    const { isStripeConfigured, createQuotePaymentLink } = await import(
      "~/lib/stripe.server"
    );
    if (!isStripeConfigured()) {
      return { success: false, error: "Stripe is not configured" };
    }

    if (!quote.stripePaymentLinkId || !quote.stripePaymentLinkActive) {
      const paymentLink = await createQuotePaymentLink({
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        totalDollars: quote.total!,
        customerId: quote.customerId,
      });
      await updateQuote(
        quoteId,
        {
          status: "Sent",
          stripePaymentLinkUrl: paymentLink.url,
          stripePaymentLinkId: paymentLink.id,
          stripePaymentLinkActive: true,
          rejectionReason: null,
        },
        eventContext
      );
      return { success: true };
    }
  }

  await updateQuote(
    quoteId,
    { status: "Sent", rejectionReason: null },
    eventContext
  );
  return { success: true };
}

/**
 * When a quote outbound is rejected while still pending_approval, restore the quote
 * to the status it had before the approval-queue send (RFQ or Draft) and clear send-only fields.
 */
export async function revertQuoteAfterPendingEmailRejection(
  quoteId: number,
  sentEmailId: number,
  eventContext: QuoteEventContext,
): Promise<TransitionResult> {
  const quote = await getQuote(quoteId);
  if (!quote) return { success: false, error: "Quote not found" };
  if (quote.status !== "Sent") {
    return { success: true };
  }

  const [fromAwaiting] = await db
    .select()
    .from(eventLogs)
    .where(
      and(
        eq(eventLogs.entityType, "quote"),
        eq(eventLogs.entityId, String(quoteId)),
        eq(eventLogs.eventType, "quote_email_awaiting_approval"),
        sql`(${eventLogs.metadata}->>'sentEmailId')::int = ${sentEmailId}`,
      ),
    )
    .orderBy(desc(eventLogs.createdAt))
    .limit(1);

  let previousStatus: "RFQ" | "Draft" | null = null;
  const m = fromAwaiting?.metadata as
    | { previousStatus?: string }
    | null
    | undefined;
  if (m?.previousStatus === "RFQ" || m?.previousStatus === "Draft") {
    previousStatus = m.previousStatus;
  }

  if (!previousStatus) {
    const recent = await getEventsByEntity("quote", String(quoteId), 30);
    const toSent = recent.find(
      (e) =>
        e.eventType === "quote_status_changed" &&
        (e.metadata as { newStatus?: string } | null)?.newStatus === "Sent",
    );
    const old = (toSent?.metadata as { oldStatus?: string } | null)?.oldStatus;
    if (old === "RFQ" || old === "Draft") {
      previousStatus = old;
    }
  }

  if (!previousStatus) {
    previousStatus = "Draft";
  }

  await updateQuote(
    quoteId,
    {
      status: previousStatus,
      validUntil: null,
    },
    eventContext,
  );
  return { success: true };
}
