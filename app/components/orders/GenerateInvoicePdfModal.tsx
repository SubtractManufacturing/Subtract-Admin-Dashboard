import { useEffect, useState } from "react";
import PdfGenerationModal from "~/components/shared/PdfGenerationModal";
import {
  InvoicePdfTemplate,
  invoicePresetsForEntity,
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
  /** Applied when the modal opens (e.g. confirmation → Paid or Order Confirmation). */
  initialPresetId?: InvoicePdfPresetId;
}

export default function GenerateInvoicePdfModal({
  isOpen,
  onClose,
  entity,
  lineItems = [],
  parts = [],
  autoDownload = true,
  initialPresetId = "default",
}: GenerateInvoicePdfModalProps) {
  const isOrder = "orderNumber" in entity;
  const availablePresets = invoicePresetsForEntity(isOrder);
  const resolvedInitialPreset: InvoicePdfPresetId =
    availablePresets.some((p) => p.id === initialPresetId)
      ? initialPresetId
      : "default";

  const [presetId, setPresetId] =
    useState<InvoicePdfPresetId>(resolvedInitialPreset);

  useEffect(() => {
    if (isOpen) {
      setPresetId(resolvedInitialPreset);
    }
  }, [isOpen, resolvedInitialPreset]);

  const apiEndpoint = isOrder
    ? `/orders/${entity.orderNumber}`
    : `/quotes/${entity.id}`;

  const modalTitle =
    presetId === "order_confirmation"
      ? "Generate Order Confirmation PDF"
      : "Generate Invoice PDF";

  return (
    <PdfGenerationModal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      apiEndpoint={apiEndpoint}
      autoDownload={autoDownload}
      intent="generateInvoice"
      formFields={{ presetId }}
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
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm px-3 py-1.5 w-48 max-w-[14rem] shrink-0"
            value={presetId}
            onChange={(e) => setPresetId(e.target.value as InvoicePdfPresetId)}
          >
            {availablePresets.map((p) => (
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
