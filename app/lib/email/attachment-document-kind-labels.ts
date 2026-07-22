import type { AttachmentDocumentKind } from "~/lib/db/schema";

export const ATTACHMENT_DOCUMENT_KIND_LABELS: Record<
  AttachmentDocumentKind,
  string
> = {
  quote: "Quote PDF",
  invoice: "Invoice",
  purchase_order: "Purchase order",
  packing_slip: "Packing slip",
  order_confirmation: "Order confirmation",
};
