import { useState } from "react";
import PdfGenerationModal from "~/components/shared/PdfGenerationModal";
import {
  InvoicePdfTemplate,
  INVOICE_PDF_PRESETS,
  type InvoicePdfPresetId,
} from "./InvoicePdfTemplate";
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
  const [presetId, setPresetId] = useState<InvoicePdfPresetId>("default");
  const isOrder = "orderNumber" in entity;
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
      previewToolbar={
        <>
          <label
            htmlFor="invoice-pdf-preset"
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Preset
          </label>
          <select
            id="invoice-pdf-preset"
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm px-3 py-1.5 w-40 max-w-[11rem] shrink-0"
            value={presetId}
            onChange={(e) => setPresetId(e.target.value as InvoicePdfPresetId)}
          >
            {INVOICE_PDF_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </>
      }
    >
      <InvoicePdfTemplate
        entity={entity}
        lineItems={lineItems}
        parts={parts}
        editable={true}
        presetId={presetId}
      />
    </PdfGenerationModal>
  );
}
