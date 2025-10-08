import PdfGenerationModal from "~/components/shared/PdfGenerationModal";
import { QuotePdfTemplate } from "./QuotePdfTemplate";
import type { QuoteWithRelations } from "~/lib/quotes";

interface GenerateQuotePdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  quote: QuoteWithRelations;
}

export default function GenerateQuotePdfModal({
  isOpen,
  onClose,
  quote,
}: GenerateQuotePdfModalProps) {
  return (
    <PdfGenerationModal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Quote PDF"
      apiEndpoint={`/api/quotes/${quote.id}/generate-pdf`}
      filename={`quote-${quote.quoteNumber}.pdf`}
      tipMessage="Click on any highlighted field to edit it before generating the PDF. Changes will only affect the generated PDF and won't modify the quote data."
    >
      <QuotePdfTemplate quote={quote} editable={true} />
    </PdfGenerationModal>
  );
}
