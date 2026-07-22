import type { AttachmentDocumentKind } from "~/lib/db/schema";
import { normalizePoNumber } from "~/lib/customer-po";

/**
 * Soft default for Generate Invoice when an order has a customer PO number.
 * Caller may still let the user switch presets.
 */
export function resolveDefaultInvoicePresetId(
  poNumber: string | null | undefined,
): "order_confirmation" | "default" {
  return normalizePoNumber(poNumber) ? "order_confirmation" : "default";
}

/**
 * Maps invoice PDF preset → persisted attachment metadata for order generation.
 * Quotes always generate invoices; order_confirmation is order-only.
 */
export function resolveInvoiceGenerationMeta(
  presetId: string | null | undefined,
  orderNumber: string,
): { documentKind: AttachmentDocumentKind; filename: string } {
  if (presetId === "order_confirmation") {
    return {
      documentKind: "order_confirmation",
      filename: `Order-Confirmation-${orderNumber}.pdf`,
    };
  }

  return {
    documentKind: "invoice",
    filename: `Invoice-${orderNumber}.pdf`,
  };
}

/** Large header title rendered in the invoice PDF preview. */
export function getInvoiceDocumentTitle(presetId: string): string {
  if (presetId === "order_confirmation") {
    return "ORDER CONFIRMATION";
  }
  return "INVOICE";
}
