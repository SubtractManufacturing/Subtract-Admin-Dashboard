import type { ReactNode } from "react"
import { useEffect, useRef } from "react"
import { modalStyles } from "~/utils/tw-styles"

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  zIndex?: number
}

export default function Modal({ isOpen, onClose, title, children, zIndex = 50 }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    if (!isOpen) return
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Only close if this is the topmost modal
        const allModals = document.querySelectorAll('[role="dialog"]');
        const topmostModal = Array.from(allModals).reduce((topmost, modal) => {
          const modalContainer = modal.closest('.modal-overlay') as HTMLElement;
          if (!modalContainer) return topmost;
          const topmostContainer = topmost?.closest('.modal-overlay') as HTMLElement;
          if (!topmostContainer) return modal;
          const modalZ = parseInt(modalContainer.style.zIndex || '50');
          const topmostZ = parseInt(topmostContainer.style.zIndex || '50');
          return modalZ > topmostZ ? modal : topmost;
        }, allModals[0]);
        
        if (topmostModal === modalRef.current) {
          onClose();
        }
      }
    }
    
    const handleClickOutside = (e: MouseEvent) => {
      // Only handle clicks on this modal's overlay
      if (e.target === overlayRef.current) {
        onClose()
      }
    }
    
    document.addEventListener('keydown', handleEscape)
    document.addEventListener('mousedown', handleClickOutside)
    
    // Focus the modal when it opens
    modalRef.current?.focus()
    
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])
  
  if (!isOpen) return null

  return (
    <div ref={overlayRef} className={`${modalStyles.overlay} modal-overlay`} style={{ zIndex }}>
      <div 
        ref={modalRef}
        className={`${modalStyles.content} max-h-[80vh] overflow-auto shadow-lg`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
      >
        <div className={modalStyles.header}>
          <h2 id="modal-title" className={modalStyles.title}>{title}</h2>
          <button
            className={modalStyles.closeButton}
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}