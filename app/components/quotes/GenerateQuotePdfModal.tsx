import { useState } from "react";
import PdfGenerationModal from "~/components/shared/PdfGenerationModal";
import {
  QuotePdfTemplate,
  QUOTE_PDF_PRESETS,
  type QuotePdfPresetId,
} from "./QuotePdfTemplate";
import type { QuoteWithRelations } from "~/lib/quotes";

interface GenerateQuotePdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  quote: QuoteWithRelations;
  autoDownload?: boolean;
}

export default function GenerateQuotePdfModal({
  isOpen,
  onClose,
  quote,
  autoDownload = true,
}: GenerateQuotePdfModalProps) {
  const [presetId, setPresetId] = useState<QuotePdfPresetId>("default");

  return (
    <PdfGenerationModal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Quote PDF"
      apiEndpoint={`/quotes/${quote.id}`}
      autoDownload={autoDownload}
      intent="generateQuote"
      previewToolbar={
        <>
          <label
            htmlFor="quote-pdf-preset"
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Preset
          </label>
          <select
            id="quote-pdf-preset"
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm px-3 py-1.5 w-40 max-w-[11rem] shrink-0"
            value={presetId}
            onChange={(e) => setPresetId(e.target.value as QuotePdfPresetId)}
          >
            {QUOTE_PDF_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </>
      }
    >
      <QuotePdfTemplate quote={quote} editable={true} presetId={presetId} />
    </PdfGenerationModal>
  );
}
