import { Part3DViewer } from '~/components/shared/Part3DViewer';
import { useEffect, useRef } from 'react';

interface Part3DViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  partName?: string;
  modelUrl?: string;
  solidModelUrl?: string;
  partId?: string;
  onThumbnailUpdate?: (thumbnailUrl: string) => void;
}

export function Part3DViewerModal({ 
  isOpen, 
  onClose, 
  partName,
  modelUrl,
  solidModelUrl,
  partId,
  onThumbnailUpdate
}: Part3DViewerModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!isOpen) return;
    
    // Prevent body scroll when modal is open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    
    // Cleanup function
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);
  
  if (!isOpen) return null;
  
  return (
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
        className="relative w-[80vw] h-[80vh] bg-gray-900 rounded-lg overflow-hidden shadow-2xl"
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 p-2 bg-gray-800/80 hover:bg-gray-700 rounded-full transition-colors"
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            fill="currentColor"
            viewBox="0 0 16 16"
            className="text-gray-300"
          >
            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
          </svg>
        </button>
        
        <Part3DViewer 
          partName={partName} 
          modelUrl={modelUrl} 
          solidModelUrl={solidModelUrl}
          partId={partId}
          onThumbnailUpdate={onThumbnailUpdate}
        />
      </div>
    </div>
  );
}