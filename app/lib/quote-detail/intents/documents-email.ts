/**
 * Quote documents (PDF), outbound email, and the price calculator.
 */
import { addBusinessDays, leadTimeOptionToBusinessDays } from "~/lib/business-days";
import { EMAIL_CONTEXT } from "~/lib/email/email-context-registry";
import {
  badRequest,
  forbidden,
  ok,
  type IntentTable,
} from "~/lib/route-actions/core";
import { generateEntityDocument } from "~/lib/route-actions/entity-documents";
import { json } from "@remix-run/node";
import { ensureDraft, type QuoteCtx } from "../context";
import type { QuoteDeps } from "../ports";

type Ctx = QuoteCtx<
  Pick<QuoteDeps, "documents" | "email" | "quotes" | "clock">
>;

export const documentIntents: IntentTable<Ctx> = {
  generateQuote: (ctx, formData) =>
    generateEntityDocument(ctx.deps.documents, {
      entityType: "quote",
      entityId: ctx.quote.id,
      htmlContent: formData.get("htmlContent"),
      filename: `Quote-${ctx.quote.quoteNumber}.pdf`,
      documentKind: "quote",
      actor: ctx.actor,
    }),

  generateInvoice: (ctx, formData) =>
    generateEntityDocument(ctx.deps.documents, {
      entityType: "quote",
      entityId: ctx.quote.id,
      htmlContent: formData.get("htmlContent"),
      filename: `Invoice-${ctx.quote.quoteNumber}.pdf`,
      documentKind: "invoice",
      actor: ctx.actor,
    }),
};

export const emailIntents: IntentTable<Ctx> = {
  emailPreview: (ctx, formData) =>
    ctx.deps.email.preview({
      auth: ctx.auth,
      formData,
      expected: {
        contextKey: EMAIL_CONTEXT.QUOTE_SEND,
        entityId: String(ctx.quote.id),
      },
    }),

  emailQueue: (ctx, formData) =>
    ctx.deps.email.queue({
      auth: ctx.auth,
      formData,
      expected: {
        contextKey: EMAIL_CONTEXT.QUOTE_SEND,
        entityType: "quote",
        entityId: String(ctx.quote.id),
      },
    }),

  /** Acknowledge an RFQ ("we received your request") to the customer. */
  async sendQuoteReceivedEmail(ctx, formData) {
    if (!(await ctx.deps.email.outboundEnabled())) {
      return forbidden("Outbound email is disabled.");
    }
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
    if (!idempotencyKey) return badRequest("Missing idempotency key.");

    const result = await ctx.deps.email.enqueueQuoteReceived({
      auth: ctx.auth,
      quoteId: ctx.quote.id,
      idempotencyKey,
    });
    if (!result.ok) {
      return json({ error: result.error }, { status: result.status });
    }
    return json({ success: true, delivery: result.delivery });
  },
};

export const priceCalculationIntents: IntentTable<Ctx> = {
  /** Persist a price calculation; seed the lead time from it if none is set yet. */
  async savePriceCalculation(ctx, formData) {
    await ensureDraft(ctx);

    const raw = formData.get("calculationData");
    if (typeof raw !== "string" || !raw) return badRequest("Missing calculation data");

    let calculation: Record<string, unknown>;
    try {
      calculation = JSON.parse(raw);
    } catch {
      return badRequest("Invalid calculation data");
    }

    await ctx.deps.quotes.savePriceCalculation(
      calculation,
      ctx.actor.userId ?? ctx.auth.userDetails.id,
    );

    const { quote } = ctx;
    if (
      quote.leadTimeBusinessDaysMin == null &&
      quote.leadTimeBusinessDaysMax == null &&
      calculation.leadTimeOption
    ) {
      const { min, max } = leadTimeOptionToBusinessDays(
        calculation.leadTimeOption as string,
      );
      const today = ctx.deps.clock.today();
      await ctx.deps.quotes.update(
        quote.id,
        {
          leadTimeBusinessDaysMin: min,
          leadTimeBusinessDaysMax: max,
          estimatedDeliveryDateStart: addBusinessDays(today, min),
          estimatedDeliveryDateEnd: addBusinessDays(today, max),
        },
        ctx.actor,
      );
    }

    return ok();
  },
};
