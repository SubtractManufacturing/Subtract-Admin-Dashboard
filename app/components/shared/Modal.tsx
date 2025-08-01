import type { ReactNode } from "react"
import { useEffect, useRef } from "react"
import { modalStyles } from "~/utils/tw-styles"

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export default function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    if (!isOpen) return
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
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
    <div className={modalStyles.overlay}>
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