import PdfGenerationModal from "~/components/shared/PdfGenerationModal";
import { PurchaseOrderPdfTemplate } from "./PurchaseOrderPdfTemplate";
import type { OrderWithRelations } from "~/lib/orders";
import type { Part, OrderLineItem } from "~/lib/db/schema";

interface GeneratePurchaseOrderPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: OrderWithRelations;
  lineItems?: OrderLineItem[];
  parts?: (Part | null)[];
  autoDownload?: boolean;
}

export default function GeneratePurchaseOrderPdfModal({
  isOpen,
  onClose,
  order,
  lineItems = [],
  parts = [],
  autoDownload = true,
}: GeneratePurchaseOrderPdfModalProps) {
  return (
    <PdfGenerationModal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Purchase Order PDF"
      apiEndpoint={`/orders/${order.id}`}
      filename={`PO-${order.orderNumber}.pdf`}
      autoDownload={autoDownload}
      intent="generatePurchaseOrder"
    >
      <PurchaseOrderPdfTemplate order={order} lineItems={lineItems} parts={parts} editable={true} />
    </PdfGenerationModal>
  );
}
