import Stripe from "stripe";
import { getStripeDefaults } from "./developerSettings";

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

interface CreatePaymentLinkParams {
  quoteId: number;
  quoteNumber: string;
  totalDollars: string;
  customerId: number;
}

interface PaymentLinkResult {
  url: string;
  id: string;
}

export async function createQuotePaymentLink(
  params: CreatePaymentLinkParams
): Promise<PaymentLinkResult> {
  const stripe = getStripeClient();
  if (!stripe)
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");

  const defaults = await getStripeDefaults();

  const amountCents = Math.round(parseFloat(params.totalDollars) * 100);
  if (amountCents <= 0)
    throw new Error("Quote total must be greater than $0.");

  const linkParams: Stripe.PaymentLinkCreateParams = {
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: params.quoteNumber,
            description: `Payment for Subtract Manufacturing Quote #${params.quoteNumber}`,
          },
        },
        quantity: 1,
      },
    ],
    automatic_tax: { enabled: false },
    inactive_message:
      "This quote is no longer payable. Please contact Subtract Manufacturing for an updated quote.",
    metadata: {
      quoteId: params.quoteId.toString(),
      quoteNumber: params.quoteNumber,
      customerId: params.customerId.toString(),
    },
  };

  if (defaults.collectBillingAddress) {
    linkParams.billing_address_collection = "required";
  }

  if (defaults.collectShippingAddress) {
    linkParams.shipping_address_collection = {
      allowed_countries: ["US"],
    };
  }

  if (defaults.requirePhone) {
    linkParams.phone_number_collection = { enabled: true };
  }

  if (defaults.limitPayments) {
    linkParams.restrictions = {
      completed_sessions: { limit: defaults.limitPaymentsCount },
    };
  }

  const paymentLink = await stripe.paymentLinks.create(linkParams);

  return { url: paymentLink.url, id: paymentLink.id };
}

export async function deactivateQuotePaymentLink(
  paymentLinkId: string
): Promise<void> {
  const stripe = getStripeClient();
  if (!stripe) throw new Error("Stripe is not configured.");

  await stripe.paymentLinks.update(paymentLinkId, { active: false });
}
