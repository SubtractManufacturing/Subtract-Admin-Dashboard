import PdfGenerationModal from "~/components/shared/PdfGenerationModal";
import { QuotePdfTemplate } from "./QuotePdfTemplate";
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
  return (
    <PdfGenerationModal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Quote PDF"
      apiEndpoint={`/quotes/${quote.id}`}
      filename={`Quote-${quote.quoteNumber}.pdf`}
      autoDownload={autoDownload}
      intent="generateQuote"
    >
      <QuotePdfTemplate quote={quote} editable={true} />
    </PdfGenerationModal>
  );
}
