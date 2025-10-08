import { useRef, useState, useEffect } from "react";
import Modal from "~/components/shared/Modal";
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
  const templateRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setIsGenerating(false);
      setError(null);
    }
  }, [isOpen]);

  const handleGenerate = async () => {
    if (!templateRef.current) return;

    setIsGenerating(true);
    setError(null);

    try {
      const htmlContent = templateRef.current.innerHTML;

      const formData = new FormData();
      formData.append("intent", "generatePdf");
      formData.append("quoteId", quote.id.toString());
      formData.append("htmlContent", htmlContent);

      const response = await fetch(`/api/quotes/${quote.id}/generate-pdf`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to generate PDF");
      }

      // Check if we got a PDF response
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/pdf")) {
        throw new Error("Did not receive PDF from server");
      }

      // Get the PDF blob
      const blob = await response.blob();

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `quote-${quote.quoteNumber}.pdf`;
      document.body.appendChild(a);

      a.click();

      // Clean up after a short delay
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 100);

      // Close modal on success
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      console.error("PDF generation error:", err);
      setError(err instanceof Error ? err.message : "Failed to generate PDF");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Quote PDF"
      size="full"
      zIndex={60}
    >
      <div className="p-4">
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-800 dark:text-red-200">
              <strong>Error:</strong> {error}
            </p>
          </div>
        )}

        <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            <strong>Tip:</strong> Click on any highlighted field to edit it before generating the PDF.
            Changes will only affect the generated PDF and won't modify the quote data.
          </p>
        </div>

        <div
          ref={templateRef}
          className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-auto mb-6"
          style={{ maxHeight: "80vh" }}
        >
          <QuotePdfTemplate quote={quote} editable={true} />
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isGenerating}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 dark:bg-blue-500 rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isGenerating ? (
              <>
                <svg
                  className="animate-spin h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Generating...
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Generate PDF
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
