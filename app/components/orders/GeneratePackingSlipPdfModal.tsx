import { useState } from "react";
import PdfGenerationModal from "~/components/shared/PdfGenerationModal";
import {
  PackingSlipPdfTemplate,
  PACKING_SLIP_PDF_PRESETS,
  type PackingSlipPdfPresetId,
} from "./PackingSlipPdfTemplate";
import type { OrderWithRelations } from "~/lib/orders";
import type { Part, OrderLineItem } from "~/lib/db/schema";

interface GeneratePackingSlipPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: OrderWithRelations;
  lineItems?: OrderLineItem[];
  parts?: (Part | null)[];
  autoDownload?: boolean;
}

export default function GeneratePackingSlipPdfModal({
  isOpen,
  onClose,
  order,
  lineItems = [],
  parts = [],
  autoDownload = true,
}: GeneratePackingSlipPdfModalProps) {
  const [presetId, setPresetId] = useState<PackingSlipPdfPresetId>("default");

  return (
    <PdfGenerationModal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Packing Slip PDF"
      apiEndpoint={`/orders/${order.orderNumber}`}
      autoDownload={autoDownload}
      intent="generatePackingSlip"
      previewToolbar={
        <>
          <label
            htmlFor="packing-slip-pdf-preset"
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Preset
          </label>
          <select
            id="packing-slip-pdf-preset"
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm px-3 py-1.5 w-40 max-w-[11rem] shrink-0"
            value={presetId}
            onChange={(e) =>
              setPresetId(e.target.value as PackingSlipPdfPresetId)
            }
          >
            {PACKING_SLIP_PDF_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </>
      }
    >
      <PackingSlipPdfTemplate
        order={order}
        lineItems={lineItems}
        parts={parts}
        editable={true}
        presetId={presetId}
      />
    </PdfGenerationModal>
  );
}
