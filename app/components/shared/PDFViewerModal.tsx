import { useEffect, useState } from "react";

interface PDFViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfUrl: string;
  fileName: string;
}

export default function PDFViewerModal({ isOpen, onClose, pdfUrl, fileName }: PDFViewerModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setError(false);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
      
      // Add escape key listener
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };
      document.addEventListener('keydown', handleEscape);
      
      return () => {
        document.removeEventListener('keydown', handleEscape);
        document.body.style.overflow = 'unset';
      };
    } else {
      // Re-enable body scroll when modal is closed
      document.body.style.overflow = 'unset';
    }
  }, [isOpen, onClose, pdfUrl]);

  const handleIframeLoad = () => {
    setLoading(false);
  };

  const handleIframeError = () => {
    setLoading(false);
    setError(true);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-8"
      onClick={onClose}
    >
      <div 
        className="bg-gray-900 rounded-lg shadow-2xl w-full max-w-6xl h-full ring-1 ring-white/10 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`PDF Viewer - ${fileName}`}
      >
        <div className="relative w-full h-full">
          {loading && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800 z-10">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100"></div>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Loading PDF...</p>
              </div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800">
              <div className="text-center">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Unable to display PDF</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">Your browser may not support inline PDF viewing</p>
              </div>
            </div>
          )}
          {!error && (
            <iframe
              src={pdfUrl}
              className="w-full h-full border-0"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              title={`PDF Viewer - ${fileName}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}