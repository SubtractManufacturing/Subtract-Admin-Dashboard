import { getQuote, updateQuote, type QuoteEventContext } from "./quotes";
import { isStripePaymentLinksEnabled } from "./featureFlags";

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
