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
      apiEndpoint={`/api/quotes/${quote.id}/generate-pdf`}
      filename={`quote-${quote.quoteNumber}.pdf`}
      autoDownload={autoDownload}
    >
      <QuotePdfTemplate quote={quote} editable={true} />
    </PdfGenerationModal>
  );
}
