/**
 * Quote lifecycle intents: status changes, conversion to an Order, revision,
 * duplication, archive/restore and header fields (customer, vendor, validity,
 * estimated delivery).
 */
import { redirect } from "@remix-run/node";
import { addBusinessDays } from "~/lib/business-days";
import { badRequest, ok, type IntentTable } from "~/lib/route-actions/core";
import { validateQuoteForAcceptance } from "../acceptance";
import {
  ensureDraft,
  redirectToQuote,
  type QuoteCtx,
  type QuoteEntity,
  type QuoteStatus,
} from "../context";
import type { QuoteDeps } from "../ports";

type Ctx = QuoteCtx<Pick<QuoteDeps, "quotes" | "stripe" | "events" | "clock">>;

const QUOTE_STATUSES: readonly QuoteStatus[] = [
  "RFQ",
  "Draft",
  "Sent",
  "Accepted",
  "Rejected",
  "Dropped",
  "Expired",
];

/** Only these can be reopened for editing. Accepted quotes are immutable. */
export const REVISABLE_STATUSES: readonly QuoteStatus[] = [
  "Sent",
  "Dropped",
  "Rejected",
  "Expired",
];

/** Moving to one of these ends the payment link's usefulness. */
const STRIPE_CLOSING_STATUSES: readonly QuoteStatus[] = [
  "Accepted",
  "Rejected",
  "Expired",
];

/**
 * Turn off a Quote's Stripe payment link when Stripe is enabled. Best effort:
 * a Stripe outage must not block the status change, so failures are logged.
 */
export async function deactivatePaymentLink(
  ctx: Ctx,
  opts: { markInactiveOnQuote: boolean; failureLabel: string },
): Promise<void> {
  const linkId = ctx.quote.stripePaymentLinkId;
  if (!linkId || !(await ctx.deps.stripe.enabled())) return;
  try {
    await ctx.deps.stripe.deactivatePaymentLink(linkId);
    if (opts.markInactiveOnQuote) {
      await ctx.deps.quotes.update(
        ctx.quote.id,
        { stripePaymentLinkActive: false },
        ctx.actor,
      );
    }
  } catch (stripeError) {
    console.error(opts.failureLabel, stripeError);
  }
}

/** Convert and answer: redirect to the new Order, or 400 with the reason. */
export async function convertAndRedirect(
  ctx: Ctx,
  fallbackError: string,
  options?: Parameters<QuoteDeps["quotes"]["convertToOrder"]>[2],
): Promise<Response> {
  const result = await ctx.deps.quotes.convertToOrder(ctx.quote.id, ctx.actor, options);
  if (result.success && result.orderNumber) {
    return redirect(`/orders/${result.orderNumber}`);
  }
  return badRequest(result.error || fallbackError);
}

/** 400 with the reasons when the quote cannot be accepted; null when it can. */
export function acceptanceBlockedResponse(quote: QuoteEntity): Response | null {
  const validationErrors = validateQuoteForAcceptance(quote);
  if (validationErrors.length === 0) return null;
  return badRequest("Cannot accept quote", { validationErrors });
}

export const lifecycleIntents: IntentTable<Ctx> = {
  async updateStatus(ctx, formData) {
    const status = formData.get("status") as QuoteStatus | null;
    if (!status || !QUOTE_STATUSES.includes(status)) {
      return badRequest("Invalid status");
    }
    const rejectionReason = formData.get("rejectionReason");

    if (status === "Sent") {
      const result = await ctx.deps.quotes.transitionToSent(ctx.quote.id, ctx.actor);
      if (!result.success) return badRequest(result.error ?? "Failed to send quote");
      return redirectToQuote(ctx.quote);
    }

    // NOTE: the link is closed before acceptance is validated, so a refused
    // acceptance still deactivates it. Preserved from the original route.
    if (STRIPE_CLOSING_STATUSES.includes(status)) {
      await deactivatePaymentLink(ctx, {
        markInactiveOnQuote: true,
        failureLabel: "Stripe deactivation failed:",
      });
    }

    if (status === "Accepted") {
      const blocked = acceptanceBlockedResponse(ctx.quote);
      if (blocked) return blocked;
      return convertAndRedirect(ctx, "Failed to convert quote to order");
    }

    await ctx.deps.quotes.update(
      ctx.quote.id,
      {
        status,
        rejectionReason:
          status === "Rejected" && typeof rejectionReason === "string"
            ? rejectionReason
            : null,
      },
      ctx.actor,
    );
    return redirectToQuote(ctx.quote);
  },

  async updateQuote(ctx, formData) {
    await ensureDraft(ctx);

    const updates: { expirationDays?: number } = {};
    const raw = formData.get("expirationDays");
    if (raw !== null) {
      const days = parseInt(String(raw), 10);
      if (Number.isNaN(days) || days < 1 || days > 365) {
        return badRequest("Expiration days must be between 1 and 365");
      }
      updates.expirationDays = days;
    }

    await ctx.deps.quotes.update(ctx.quote.id, updates, ctx.actor);
    return ok();
  },

  async updateNdaRequired(ctx, formData) {
    await ctx.deps.quotes.update(
      ctx.quote.id,
      { ndaRequired: formData.get("ndaRequired") === "true" },
      ctx.actor,
    );
    return ok();
  },

  async updateCustomer(ctx, formData) {
    await ensureDraft(ctx);

    const raw = formData.get("customerId");
    if (!raw) return badRequest("Customer ID is required");
    const customerId = parseInt(String(raw), 10);
    if (Number.isNaN(customerId)) return badRequest("Invalid customer ID");

    await ctx.deps.quotes.update(ctx.quote.id, { customerId }, ctx.actor);
    return ok();
  },

  async updateVendor(ctx, formData) {
    await ensureDraft(ctx);

    const raw = formData.get("vendorId");
    const vendorId = raw ? parseInt(String(raw), 10) : null;
    if (vendorId !== null && Number.isNaN(vendorId)) {
      return badRequest("Invalid vendor ID");
    }

    await ctx.deps.quotes.update(ctx.quote.id, { vendorId }, ctx.actor);
    return ok();
  },

  async updateEstimatedDelivery(ctx, formData) {
    await ensureDraft(ctx);

    const min = parseInt(String(formData.get("leadTimeBusinessDaysMin")), 10);
    const max = parseInt(String(formData.get("leadTimeBusinessDaysMax")), 10);
    if (Number.isNaN(min) || Number.isNaN(max) || min < 0 || max < min) {
      return badRequest("Invalid lead time business day range");
    }

    const today = ctx.deps.clock.today();
    await ctx.deps.quotes.update(
      ctx.quote.id,
      {
        leadTimeBusinessDaysMin: min,
        leadTimeBusinessDaysMax: max,
        estimatedDeliveryDateStart: addBusinessDays(today, min),
        estimatedDeliveryDateEnd: addBusinessDays(today, max),
      },
      ctx.actor,
    );
    return ok();
  },

  async updateValidUntil(ctx, formData) {
    await ensureDraft(ctx);

    const raw = formData.get("validUntil");
    if (!raw) return badRequest("Valid until date is required");
    const validUntil = new Date(String(raw));
    if (Number.isNaN(validUntil.getTime())) return badRequest("Invalid date");

    await ctx.deps.quotes.update(ctx.quote.id, { validUntil }, ctx.actor);
    return ok();
  },

  async convertToOrder(ctx) {
    return convertAndRedirect(ctx, "Failed to convert quote");
  },

  async reviseQuote(ctx) {
    const oldStatus = ctx.quote.status;
    if (!REVISABLE_STATUSES.includes(oldStatus)) {
      return badRequest(
        "Only sent, dropped, rejected, or expired quotes can be revised. Accepted quotes are immutable.",
      );
    }

    if (ctx.quote.stripePaymentLinkActive) {
      await deactivatePaymentLink(ctx, {
        markInactiveOnQuote: false,
        failureLabel: "Stripe payment link deactivation failed during revision:",
      });
    }

    await ctx.deps.quotes.resetToDraftForRevision(ctx.quote.id);

    await ctx.deps.events.create({
      entityType: "quote",
      entityId: String(ctx.quote.id),
      eventType: "quote_revised",
      eventCategory: "status",
      title: "Quote Revised",
      description: `Quote was revised and reverted to Draft status from ${oldStatus}`,
      metadata: {
        oldStatus,
        newStatus: "Draft",
        quoteNumber: ctx.quote.quoteNumber,
      },
      userId: ctx.actor.userId,
      userEmail: ctx.actor.userEmail,
    });

    return redirectToQuote(ctx.quote);
  },

  async duplicateQuote(ctx) {
    const result = await ctx.deps.quotes.duplicate(ctx.quote.id, ctx.actor);
    if (result.success && result.quoteNumber) {
      return redirect(`/quotes/${result.quoteId}`);
    }
    return badRequest(result.error || "Failed to duplicate quote");
  },

  async archiveQuote(ctx) {
    await ctx.deps.quotes.archive(ctx.quote.id, ctx.actor);
    return redirect("/quotes");
  },

  async restoreQuote(ctx) {
    await ctx.deps.quotes.restore(ctx.quote.id, ctx.actor);
    return redirectToQuote(ctx.quote);
  },
};
