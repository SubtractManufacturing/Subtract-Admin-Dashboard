import { useEffect, useRef, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Part3DViewer } from '~/components/shared/Part3DViewer';
import { Part3DViewerModal } from '~/components/shared/Part3DViewerModal';
import FileViewerModal from '~/components/shared/FileViewerModal';
import { isViewableFile, getFileType } from '~/lib/file-utils';

interface QuotePart {
  id: string;
  partName: string;
  partMeshUrl: string | null;
  partFileUrl: string | null;
  signedMeshUrl?: string;
  signedFileUrl?: string;
  signedThumbnailUrl?: string;
  conversionStatus: string | null;
  material: string | null;
  finish: string | null;
  tolerance: string | null;
  description?: string | null;
  drawings?: Array<{
    id: string;
    fileName: string;
    contentType: string | null;
    fileSize: number | null;
    signedUrl: string;
  }>;
}

interface QuotePartsModalProps {
  isOpen: boolean;
  onClose: () => void;
  parts: QuotePart[];
  quoteId?: number;
}

export function QuotePartsModal({ isOpen, onClose, parts, quoteId }: QuotePartsModalProps) {
  const meshFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const uploadFetcher = useFetcher();
  const modalRef = useRef<HTMLDivElement>(null);
  const [selectedPart, setSelectedPart] = useState<QuotePart | null>(null);
  const [isPart3DModalOpen, setIsPart3DModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{
    url: string;
    type: string;
    fileName: string;
    contentType?: string;
    fileSize?: number;
  } | null>(null);
  const [isFileViewerOpen, setIsFileViewerOpen] = useState(false);
  const [showDrawingsMenu, setShowDrawingsMenu] = useState<string | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const hasDragged = useRef(false);
  const drawingInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  useEffect(() => {
    if (!isOpen) {
      // Ensure body scroll is restored when modal is closed
      document.body.style.overflow = '';
      return;
    }

    // Prevent body scroll when modal is open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close drawings menu first if open
        if (showDrawingsMenu) {
          setShowDrawingsMenu(null);
        } else if (!isPart3DModalOpen && !isFileViewerOpen) {
          // Only close modal if the 3D modal and file viewer are not open
          onClose();
        }
      }
    };

    const handleClickOutside = () => {
      if (showDrawingsMenu) {
        setShowDrawingsMenu(null);
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.addEventListener('click', handleClickOutside);

    // Cleanup function
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('click', handleClickOutside);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, isPart3DModalOpen, isFileViewerOpen, showDrawingsMenu, onClose]);

  // Monitor upload fetcher state
  useEffect(() => {
    if (uploadFetcher.state === 'idle' && uploadFetcher.data) {
      if (typeof uploadFetcher.data === 'object' && uploadFetcher.data !== null && 'error' in uploadFetcher.data) {
        console.error('Upload error:', uploadFetcher.data.error);
        alert(`Upload failed: ${uploadFetcher.data.error}`);
      }
    }
  }, [uploadFetcher.state, uploadFetcher.data]);

  const handleView3D = (part: QuotePart) => {
    setSelectedPart(part);
    setIsPart3DModalOpen(true);
  };

  const handleRegenerateMesh = (partId: string) => {
    if (!quoteId) return;

    const formData = new FormData();
    formData.append('intent', 'regenerateMesh');
    formData.append('partId', partId);

    meshFetcher.submit(formData, {
      method: 'post',
      action: `/quotes/${quoteId}`,
    });
  };

  const handleDeleteDrawing = (drawingId: string, partId: string) => {
    if (!quoteId || !confirm('Are you sure you want to delete this drawing?')) return;

    const formData = new FormData();
    formData.append('intent', 'deleteDrawing');
    formData.append('drawingId', drawingId);
    formData.append('quotePartId', partId);

    deleteFetcher.submit(formData, {
      method: 'post',
      action: `/quotes/${quoteId}`,
    });
  };

  const handleAddDrawing = (partId: string, files: FileList | null) => {
    if (!quoteId || !files || files.length === 0) return;

    const formData = new FormData();
    formData.append('intent', 'addDrawingToExistingPart');
    formData.append('quotePartId', partId);

    Array.from(files).forEach((file, index) => {
      formData.append(`drawing_${index}`, file);
    });
    formData.append('drawingCount', files.length.toString());

    uploadFetcher.submit(formData, {
      method: 'post',
      action: `/quotes/${quoteId}`,
      encType: 'multipart/form-data',
    });

    // Reset file input
    if (drawingInputRefs.current[partId]) {
      drawingInputRefs.current[partId]!.value = '';
    }
  };

  const handleViewDrawing = (drawing: { signedUrl: string; fileName: string; contentType: string | null; fileSize: number | null }) => {
    const fileTypeInfo = getFileType(drawing.fileName);

    if (isViewableFile(drawing.fileName)) {
      setSelectedFile({
        url: drawing.signedUrl,
        type: fileTypeInfo.type,
        fileName: drawing.fileName,
        contentType: drawing.contentType || undefined,
        fileSize: drawing.fileSize || undefined,
      });
      setIsFileViewerOpen(true);
    } else {
      // Download non-viewable files
      window.open(drawing.signedUrl, '_blank');
    }
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
                    className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden relative"
                  >
                    {/* Technical Drawing Icons - Top Right Corner */}
                    <div className="absolute top-2 right-2 z-10 flex gap-1">
                      {/* Upload Drawing Button - Only show if no drawings exist */}
                      {(!part.drawings || part.drawings.length === 0) && (
                        <div className="group relative">
                          <input
                            ref={(el) => { drawingInputRefs.current[part.id] = el; }}
                            type="file"
                            multiple
                            accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
                            onChange={(e) => handleAddDrawing(part.id, e.target.files)}
                            className="hidden"
                          />
                          <button
                            onClick={() => drawingInputRefs.current[part.id]?.click()}
                            className="p-2 bg-white/90 dark:bg-gray-800/90 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded-lg shadow-sm transition-colors backdrop-blur-sm"
                            disabled={uploadFetcher.state === 'submitting'}
                            title="Upload technical drawing"
                          >
                            {uploadFetcher.state === 'submitting' ? (
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                            ) : (
                              <svg className="w-4 h-4 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                              </svg>
                            )}
                          </button>
                          <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block">
                            <div className="bg-gray-900 text-white text-xs rounded py-1 px-2 whitespace-nowrap">
                              Upload technical drawing
                            </div>
                          </div>
                        </div>
                      )}

                      {/* View Drawings Button */}
                      {part.drawings && part.drawings.length > 0 && (
                        <div className="group relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowDrawingsMenu(showDrawingsMenu === part.id ? null : part.id);
                            }}
                            className="p-2 bg-white/90 dark:bg-gray-800/90 hover:bg-green-50 dark:hover:bg-green-900/50 rounded-lg shadow-sm transition-colors backdrop-blur-sm relative"
                            title={part.drawings.length === 1 ? part.drawings[0].fileName : `${part.drawings.length} drawings`}
                          >
                            <svg className="w-4 h-4 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            {part.drawings.length > 1 && (
                              <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                                {part.drawings.length}
                              </span>
                            )}
                          </button>
                          <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block">
                            <div className="bg-gray-900 text-white text-xs rounded py-1 px-2 whitespace-nowrap max-w-xs truncate">
                              {part.drawings.length === 1 ? part.drawings[0].fileName : `${part.drawings.length} drawings`}
                            </div>
                          </div>

                          {/* Drawings Menu */}
                          {showDrawingsMenu === part.id && (
                            <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-20 min-w-[250px] max-w-xs">
                              {part.drawings.map((drawing) => (
                                <div key={drawing.id} className="border-b border-gray-100 dark:border-gray-700 last:border-b-0">
                                  <div className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 truncate font-medium">
                                    {drawing.fileName}
                                  </div>
                                  <div className="flex gap-1 px-2 pb-2">
                                    <button
                                      onClick={() => {
                                        handleViewDrawing(drawing);
                                        setShowDrawingsMenu(null);
                                      }}
                                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded transition-colors"
                                      title="View drawing"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                      </svg>
                                      View
                                    </button>
                                    <button
                                      onClick={() => {
                                        window.open(drawing.signedUrl, '_blank');
                                        setShowDrawingsMenu(null);
                                      }}
                                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/50 rounded transition-colors"
                                      title="Download drawing"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                      </svg>
                                      Download
                                    </button>
                                    <button
                                      onClick={() => {
                                        handleDeleteDrawing(drawing.id, part.id);
                                        setShowDrawingsMenu(null);
                                      }}
                                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 rounded transition-colors"
                                      title="Delete drawing"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div
                      className={`aspect-square bg-gray-100 dark:bg-gray-800 relative ${
                        part.signedMeshUrl && part.conversionStatus === 'completed'
                          ? 'cursor-pointer hover:opacity-90 transition-opacity'
                          : ''
                      }`}
                      onMouseDown={(e) => {
                        dragStartPos.current = { x: e.clientX, y: e.clientY };
                        hasDragged.current = false;
                      }}
                      onMouseMove={(e) => {
                        if (dragStartPos.current && !hasDragged.current) {
                          const dx = Math.abs(e.clientX - dragStartPos.current.x);
                          const dy = Math.abs(e.clientY - dragStartPos.current.y);
                          if (dx > 5 || dy > 5) {
                            hasDragged.current = true;
                          }
                        }
                      }}
                      onMouseUp={() => {
                        if (!hasDragged.current && part.signedMeshUrl && part.conversionStatus === 'completed') {
                          handleView3D(part);
                        }
                        dragStartPos.current = null;
                        hasDragged.current = false;
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
                        <div className="w-full h-full">
                          <Part3DViewer
                            modelUrl={part.signedMeshUrl}
                            solidModelUrl={part.signedFileUrl}
                            partName={part.partName}
                            partId={part.id}
                            hideControls={true}
                            isQuotePart={true}
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
                              <p className="text-sm text-red-600 dark:text-red-400 mb-2">
                                Conversion failed
                              </p>
                              {part.partFileUrl && (
                                <button
                                  onClick={() => handleRegenerateMesh(part.id)}
                                  disabled={meshFetcher.state === 'submitting'}
                                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded transition-colors"
                                >
                                  {meshFetcher.state === 'submitting' ? 'Retrying...' : 'Retry Conversion'}
                                </button>
                              )}
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
                    <div className="p-4">
                      {(part.material || part.tolerance || part.finish || part.description) && (
                        <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400 mb-3">
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
                      )}
                    </div>
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
          solidModelUrl={selectedPart.signedFileUrl}
          partId={selectedPart.id}
          isQuotePart={true}
        />
      )}

      {/* File Viewer Modal for Technical Drawings */}
      {selectedFile && (
        <FileViewerModal
          isOpen={isFileViewerOpen}
          onClose={() => {
            setIsFileViewerOpen(false);
            setSelectedFile(null);
          }}
          fileUrl={selectedFile.url}
          fileName={selectedFile.fileName}
          contentType={selectedFile.contentType}
          fileSize={selectedFile.fileSize}
        />
      )}
    </>
  );
}
