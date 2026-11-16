/**
 * Order documents (PDF), the order-confirmation email, and Stripe checkout
 * address import.
 */
import { json } from "@remix-run/node";
import { EMAIL_CONTEXT } from "~/lib/email/email-context-registry";
import { resolveInvoiceGenerationMeta } from "~/lib/invoice-pdf-output";
import { type IntentTable } from "~/lib/route-actions/core";
import { generateEntityDocument } from "~/lib/route-actions/entity-documents";
import type { OrderCtx } from "../context";
import type { OrderDeps } from "../ports";

type Ctx = OrderCtx<Pick<OrderDeps, "documents" | "email" | "checkoutAddresses">>;

export const documentIntents: IntentTable<Ctx> = {
  generatePurchaseOrder: (ctx, formData) =>
    generateEntityDocument(ctx.deps.documents, {
      entityType: "order",
      entityId: ctx.order.id,
      htmlContent: formData.get("htmlContent"),
      filename: `PO-${ctx.order.orderNumber}.pdf`,
      documentKind: "purchase_order",
      actor: ctx.actor,
    }),

  /** Invoice or, with `presetId=order_confirmation`, an order confirmation PDF. */
  generateInvoice: (ctx, formData) => {
    const presetId = formData.get("presetId");
    const { documentKind, filename } = resolveInvoiceGenerationMeta(
      typeof presetId === "string" ? presetId : null,
      ctx.order.orderNumber,
    );
    return generateEntityDocument(ctx.deps.documents, {
      entityType: "order",
      entityId: ctx.order.id,
      htmlContent: formData.get("htmlContent"),
      filename,
      documentKind,
      actor: ctx.actor,
    });
  },

  generatePackingSlip: (ctx, formData) =>
    generateEntityDocument(ctx.deps.documents, {
      entityType: "order",
      entityId: ctx.order.id,
      htmlContent: formData.get("htmlContent"),
      filename: `PackingSlip-${ctx.order.orderNumber}.pdf`,
      documentKind: "packing_slip",
      actor: ctx.actor,
    }),
};

export const emailIntents: IntentTable<Ctx> = {
  emailPreview: (ctx, formData) =>
    ctx.deps.email.preview({
      auth: ctx.auth,
      formData,
      expected: {
        contextKey: EMAIL_CONTEXT.ORDER_CONFIRMATION,
        entityId: String(ctx.order.id),
      },
    }),

  emailQueue: (ctx, formData) =>
    ctx.deps.email.queue({
      auth: ctx.auth,
      formData,
      expected: {
        contextKey: EMAIL_CONTEXT.ORDER_CONFIRMATION,
        entityType: "order",
        entityId: String(ctx.order.id),
      },
    }),
};

const choice = (formData: FormData, key: string): "checkout" | "on_file" | undefined => {
  const value = formData.get(key);
  return value === "checkout" || value === "on_file" ? value : undefined;
};

/** Copy the address the customer entered at Stripe checkout onto their record. */
export const checkoutAddressIntents: IntentTable<Ctx> = {
  async importCheckoutAddressesQuick(ctx) {
    const result = await ctx.deps.checkoutAddresses.importQuick({
      orderId: ctx.order.id,
      sourceQuoteId: ctx.order.sourceQuoteId ?? null,
      customerId: ctx.order.customerId ?? null,
      actor: ctx.actor,
    });
    return json(result);
  },

  async applyCheckoutAddressImportChoices(ctx, formData) {
    const result = await ctx.deps.checkoutAddresses.applyChoices({
      orderId: ctx.order.id,
      sourceQuoteId: ctx.order.sourceQuoteId ?? null,
      customerId: ctx.order.customerId ?? null,
      billingChoice: choice(formData, "billingChoice"),
      shippingChoice: choice(formData, "shippingChoice"),
      phoneChoice: choice(formData, "phoneChoice"),
      actor: ctx.actor,
    });
    if (!result.ok) {
      return json({ error: result.message, reason: result.reason }, { status: 400 });
    }
    return json({ success: true, updated: result.updated });
  },
};
