import type { AttachmentDocumentKind } from "~/lib/db/schema";

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
