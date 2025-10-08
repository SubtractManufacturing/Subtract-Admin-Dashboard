import type { ReactNode } from "react"
import { useEffect, useRef } from "react"
import { modalStyles } from "~/utils/tw-styles"

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  zIndex?: number
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'
}

export default function Modal({ isOpen, onClose, title, children, zIndex = 50, size = 'md' }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    if (isOpen && modalRef.current) {
      modalRef.current.focus()
    }
  }, [isOpen])

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [isOpen])
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
    
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])
  
  if (!isOpen) return null

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    '2xl': 'max-w-6xl',
    full: 'max-w-[95vw]'
  }

  const heightClasses = {
    sm: 'max-h-[80vh]',
    md: 'max-h-[80vh]',
    lg: 'max-h-[80vh]',
    xl: 'max-h-[80vh]',
    '2xl': 'max-h-[85vh]',
    full: 'max-h-[95vh] h-[95vh]'
  }

  // Get base modal styles without max-width for custom sizing
  const baseModalStyles = size === 'full'
    ? 'bg-white dark:bg-gray-800 rounded-lg p-6 w-full mx-2 transition-colors duration-150'
    : modalStyles.content;

  return (
    <div ref={overlayRef} className={`${modalStyles.overlay} modal-overlay`} style={{ zIndex }}>
      <div
        ref={modalRef}
        className={`${baseModalStyles} ${sizeClasses[size]} ${heightClasses[size]} ${size === 'full' ? 'flex flex-col' : 'overflow-auto'} shadow-lg transition-all duration-300`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
      >
        <div className={`${modalStyles.header} ${size === 'full' ? 'flex-shrink-0' : ''}`}>
          <h2 id="modal-title" className={modalStyles.title}>{title}</h2>
          <button
            className={modalStyles.closeButton}
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>
        <div className={size === 'full' ? 'flex-1 overflow-auto' : ''}>
          {children}
        </div>
      </div>
    </div>
  )
}