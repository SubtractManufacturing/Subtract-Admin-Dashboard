import PdfGenerationModal from "~/components/shared/PdfGenerationModal";
import { InvoicePdfTemplate } from "./InvoicePdfTemplate";
import type { OrderWithRelations } from "~/lib/orders";
import type { QuoteWithRelations } from "~/lib/quotes";
import type { Part, OrderLineItem, QuoteLineItem } from "~/lib/db/schema";

interface GenerateInvoicePdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  entity: OrderWithRelations | QuoteWithRelations;
  lineItems?: (OrderLineItem | QuoteLineItem)[];
  parts?: (Part | null)[];
  autoDownload?: boolean;
}

export default function GenerateInvoicePdfModal({
  isOpen,
  onClose,
  entity,
  lineItems = [],
  parts = [],
  autoDownload = true,
}: GenerateInvoicePdfModalProps) {
  const isOrder = 'orderNumber' in entity;
  const apiEndpoint = isOrder
    ? `/orders/${entity.orderNumber}`
    : `/quotes/${entity.id}`;

  return (
    <PdfGenerationModal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Invoice PDF"
      apiEndpoint={apiEndpoint}
      autoDownload={autoDownload}
      intent="generateInvoice"
    >
      <InvoicePdfTemplate entity={entity} lineItems={lineItems} parts={parts} editable={true} />
    </PdfGenerationModal>
  );
}
