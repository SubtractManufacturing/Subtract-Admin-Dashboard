import React, { useEffect, useState, Suspense } from "react";
import { getFileType, formatFileSize } from "~/lib/file-utils";
import type { FileType } from "~/lib/file-utils";

const PDFViewer = React.lazy(() => import("./file-viewers/PDFViewer"));
const ImageViewer = React.lazy(() => import("./file-viewers/ImageViewer"));
const VideoPlayer = React.lazy(() => import("./file-viewers/VideoPlayer"));
const AudioPlayer = React.lazy(() => import("./file-viewers/AudioPlayer"));
const TextViewer = React.lazy(() => import("./file-viewers/TextViewer"));

interface FileViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileUrl: string;
  fileName: string;
  contentType?: string;
  fileSize?: number;
}

export default function FileViewerModal({ 
  isOpen, 
  onClose, 
  fileUrl, 
  fileName, 
  contentType,
  fileSize 
}: FileViewerModalProps) {
  const [fileType, setFileType] = useState<FileType>('unknown');
  const [canView, setCanView] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const fileInfo = getFileType(fileName, contentType);
      setFileType(fileInfo.type);
      setCanView(fileInfo.canView);
      
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
  }, [isOpen, onClose, fileName, contentType]);

  if (!isOpen) return null;

  const renderViewer = () => {
    if (!canView) {
      return (
        <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
          <div className="text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Preview not available</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">{fileName}</p>
            <a 
              href={fileUrl} 
              download={fileName}
              className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white text-sm rounded-lg transition-colors"
            >
              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
              Download File
            </a>
          </div>
        </div>
      );
    }

    const loadingFallback = (
      <div className="flex items-center justify-center h-full bg-gray-900">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-100"></div>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Loading viewer...</p>
        </div>
      </div>
    );

    switch (fileType) {
      case 'pdf':
        return (
          <Suspense fallback={loadingFallback}>
            <PDFViewer url={fileUrl} fileName={fileName} />
          </Suspense>
        );
      case 'image':
        return (
          <Suspense fallback={loadingFallback}>
            <ImageViewer url={fileUrl} fileName={fileName} />
          </Suspense>
        );
      case 'video':
        return (
          <Suspense fallback={loadingFallback}>
            <VideoPlayer url={fileUrl} fileName={fileName} contentType={contentType || 'video/mp4'} />
          </Suspense>
        );
      case 'audio':
        return (
          <Suspense fallback={loadingFallback}>
            <AudioPlayer url={fileUrl} fileName={fileName} contentType={contentType || 'audio/mpeg'} />
          </Suspense>
        );
      case 'text':
        return (
          <Suspense fallback={loadingFallback}>
            <TextViewer url={fileUrl} fileName={fileName} />
          </Suspense>
        );
      default:
        return null;
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-8"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="Close modal overlay"
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <div 
        className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-6xl h-full ring-1 ring-gray-200 dark:ring-white/10 relative overflow-hidden focus:outline-none flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`File Viewer - ${fileName}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-gray-900 dark:text-white font-medium truncate">{fileName}</span>
            {fileSize && (
              <span className="text-gray-600 dark:text-gray-400 text-sm whitespace-nowrap">
                {formatFileSize(fileSize)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a 
              href={fileUrl} 
              download={fileName}
              className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title="Download"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
            </a>
            <button
              onClick={onClose}
              className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {renderViewer()}
        </div>
      </div>
    </div>
  );
}