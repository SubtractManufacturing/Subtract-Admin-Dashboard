import { useEffect, useRef, useState } from 'react';
import { Part3DViewer } from '~/components/shared/Part3DViewer';
import { Part3DViewerModal } from '~/components/shared/Part3DViewerModal';

interface QuotePart {
  id: string;
  partName: string;
  partMeshUrl: string | null;
  signedMeshUrl?: string;
  signedThumbnailUrl?: string;
  conversionStatus: string | null;
  material: string | null;
  finish: string | null;
  tolerance: string | null;
  description?: string | null;
}

interface QuotePartsModalProps {
  isOpen: boolean;
  onClose: () => void;
  parts: QuotePart[];
}

export function QuotePartsModal({ isOpen, onClose, parts }: QuotePartsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [selectedPart, setSelectedPart] = useState<QuotePart | null>(null);
  const [isPart3DModalOpen, setIsPart3DModalOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    // Prevent body scroll when modal is open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Only close if the 3D modal is not open
        if (!isPart3DModalOpen) {
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleEscape);

    // Cleanup function
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, isPart3DModalOpen, onClose]);

  const handleView3D = (part: QuotePart) => {
    setSelectedPart(part);
    setIsPart3DModalOpen(true);
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        role="presentation"
      >
        <div
          ref={modalRef}
          className="relative w-full max-w-7xl h-[90vh] bg-white dark:bg-gray-800 rounded-lg overflow-hidden shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Quote Parts ({parts.length})
            </h3>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
              aria-label="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                fill="currentColor"
                viewBox="0 0 16 16"
                className="text-gray-600 dark:text-gray-300"
              >
                <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {parts.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {parts.map((part) => (
                  <div
                    key={part.id}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                  >
                    <div
                      className={`aspect-square bg-gray-100 dark:bg-gray-800 relative ${
                        part.signedMeshUrl && part.conversionStatus === 'completed'
                          ? 'cursor-pointer hover:opacity-90 transition-opacity'
                          : ''
                      }`}
                      onClick={() => {
                        if (part.signedMeshUrl && part.conversionStatus === 'completed') {
                          handleView3D(part);
                        }
                      }}
                      role={part.signedMeshUrl && part.conversionStatus === 'completed' ? 'button' : undefined}
                      tabIndex={part.signedMeshUrl && part.conversionStatus === 'completed' ? 0 : undefined}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && part.signedMeshUrl && part.conversionStatus === 'completed') {
                          e.preventDefault();
                          handleView3D(part);
                        }
                      }}
                    >
                      {part.signedMeshUrl && part.conversionStatus === 'completed' ? (
                        <div className="pointer-events-none w-full h-full">
                          <Part3DViewer
                            modelUrl={part.signedMeshUrl}
                            partName={part.partName}
                            partId={part.id}
                          />
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          {part.conversionStatus === 'in_progress' ||
                          part.conversionStatus === 'queued' ||
                          part.conversionStatus === 'pending' ? (
                            <div className="text-center">
                              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-2"></div>
                              <p className="text-sm text-gray-600 dark:text-gray-400">
                                Parts loading...
                              </p>
                            </div>
                          ) : part.conversionStatus === 'failed' ? (
                            <div className="text-center px-4">
                              <svg
                                className="w-12 h-12 text-red-500 mx-auto mb-2"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                              <p className="text-sm text-red-600 dark:text-red-400">
                                Conversion failed
                              </p>
                            </div>
                          ) : (
                            <div className="text-center">
                              <svg
                                className="w-12 h-12 text-gray-400 mx-auto mb-2"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                                />
                              </svg>
                              <p className="text-sm text-gray-600 dark:text-gray-400">
                                No 3D model
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {(part.material || part.tolerance || part.finish || part.description) && (
                      <div className="p-4">
                        <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                          {part.material && (
                            <p>
                              <span className="font-medium">Material:</span> {part.material}
                            </p>
                          )}
                          {part.tolerance && (
                            <p>
                              <span className="font-medium">Tolerance:</span> {part.tolerance}
                            </p>
                          )}
                          {part.finish && (
                            <p>
                              <span className="font-medium">Finish:</span> {part.finish}
                            </p>
                          )}
                          {part.description && (
                            <p>
                              <span className="font-medium">Description:</span> {part.description}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                No parts added yet.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Full-screen 3D Viewer Modal */}
      {selectedPart && (
        <Part3DViewerModal
          isOpen={isPart3DModalOpen}
          onClose={() => {
            setIsPart3DModalOpen(false);
            setSelectedPart(null);
          }}
          partName={selectedPart.partName}
          modelUrl={selectedPart.signedMeshUrl}
          partId={selectedPart.id}
        />
      )}
    </>
  );
}
