import { useRef, useState, useEffect, type ReactNode } from "react";
import { useRevalidator } from "@remix-run/react";
import Modal from "~/components/shared/Modal";

/**
 * Converts an image URL to a base64 data URI in the browser
 * This ensures images are embedded directly in the PDF
 */
async function imageToBase64(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Enable CORS for external images

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0);

      try {
        const dataUrl = canvas.toDataURL('image/png');
        resolve(dataUrl);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error(`Failed to load image: ${url}`));
    };

    img.src = url;
  });
}

interface PdfGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  apiEndpoint: string;
  filename: string;
  children: ReactNode;
  autoDownload?: boolean;
  intent: string;
}

/**
 * Generic PDF generation modal that can be used for any document type
 * Handles the preview, editing, generation, and download flow
 */
export default function PdfGenerationModal({
  isOpen,
  onClose,
  title,
  apiEndpoint,
  filename,
  children,
  autoDownload = true,
  intent,
}: PdfGenerationModalProps) {
  const templateRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revalidator = useRevalidator();

  useEffect(() => {
    if (!isOpen) {
      setIsGenerating(false);
      setIsRefreshing(false);
      setError(null);
    }
  }, [isOpen]);

  const handleGenerate = async () => {
    if (!templateRef.current) return;

    setIsGenerating(true);
    setError(null);

    try {
      // Clone the template to avoid modifying the displayed version
      const clone = templateRef.current.cloneNode(true) as HTMLDivElement;

      // Remove any placeholder text elements that still contain default values
      const placeholders = clone.querySelectorAll('.placeholder-text');
      placeholders.forEach((element) => {
        const text = element.textContent?.trim() || '';
        // List of known placeholder texts to remove
        const defaultPlaceholders = [
          'Address Line 1',
          'City, State ZIP',
          'Phone Number',
          'Mailing Address',
          'Email',
          'Phone',
        ];

        if (defaultPlaceholders.includes(text)) {
          // Remove the parent <p> element
          element.parentElement?.remove();
        }
      });

      // Convert all images to base64 to ensure they're embedded in the PDF
      const images = clone.querySelectorAll('img');
      await Promise.all(
        Array.from(images).map(async (img) => {
          const src = img.getAttribute('src');
          if (src && !src.startsWith('data:')) {
            try {
              const base64 = await imageToBase64(src);
              img.setAttribute('src', base64);
            } catch (error) {
              console.error('Failed to convert image to base64:', src, error);
              // Leave the original URL if conversion fails
            }
          }
        })
      );

      const htmlContent = clone.innerHTML;

      const formData = new FormData();
      formData.append("htmlContent", htmlContent);
      formData.append("intent", intent);

      const response = await fetch(apiEndpoint, {
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

      // Only auto-download if feature flag is enabled
      if (autoDownload) {
        // Create download link
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);

        a.click();

        // Clean up download elements
        setTimeout(() => {
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }, 100);
      }

      // Show refreshing state
      setIsGenerating(false);
      setIsRefreshing(true);

      // Revalidate to refresh page data (attachments, etc.)
      revalidator.revalidate();

      // Wait for revalidation to complete, then close modal
      const checkRevalidation = setInterval(() => {
        if (revalidator.state === "idle") {
          clearInterval(checkRevalidation);
          setIsRefreshing(false);
          onClose();
        }
      }, 100);

      // Fallback: close after 3 seconds even if revalidation is slow
      setTimeout(() => {
        clearInterval(checkRevalidation);
        setIsRefreshing(false);
        onClose();
      }, 3000);
    } catch (err) {
      console.error("PDF generation error:", err);
      setError(err instanceof Error ? err.message : "Failed to generate PDF");
      setIsGenerating(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
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

        {isRefreshing && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-sm text-green-800 dark:text-green-200 flex items-center gap-2">
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
              <strong>Success!</strong> PDF generated and saved. Refreshing attachments...
            </p>
          </div>
        )}

        <div
          ref={templateRef}
          className="border border-gray-300 dark:border-gray-600 rounded-lg mb-6"
        >
          {children}
        </div>

        <div className="flex justify-end gap-3 sticky bottom-0 bg-white dark:bg-gray-800 pt-4 pb-2 -mx-4 px-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            disabled={isGenerating || isRefreshing}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating || isRefreshing}
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
            ) : isRefreshing ? (
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
                Refreshing...
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
