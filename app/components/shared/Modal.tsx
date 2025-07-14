import type { ReactNode } from "react"
import { modalStyles } from "~/utils/tw-styles"

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export default function Modal({ isOpen, onClose, title, children }: ModalProps) {
  if (!isOpen) return null

  return (
    <div 
      className={modalStyles.overlay}
      onClick={onClose}
    >
      <div 
        className={`${modalStyles.content} max-h-[80vh] overflow-auto shadow-lg`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={modalStyles.header}>
          <h2 className={modalStyles.title}>{title}</h2>
          <button
            className={modalStyles.closeButton}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}