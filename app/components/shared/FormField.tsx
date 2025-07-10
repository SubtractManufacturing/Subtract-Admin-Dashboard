import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react"
import { formStyles } from "~/utils/tw-styles"

interface BaseFieldProps {
  label: string
  error?: string
  required?: boolean
}

interface InputFieldProps extends BaseFieldProps, InputHTMLAttributes<HTMLInputElement> {
  type?: 'text' | 'email' | 'tel' | 'number' | 'date'
}

interface TextareaFieldProps extends BaseFieldProps, TextareaHTMLAttributes<HTMLTextAreaElement> {}

interface SelectFieldProps extends BaseFieldProps, SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode
}

export function InputField({ label, error, required, className = '', ...props }: InputFieldProps) {
  return (
    <div className="mb-4">
      <label className={formStyles.label}>
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      <input
        className={`${formStyles.input} ${className}`}
        {...props}
      />
      {error && <div className={formStyles.error}>{error}</div>}
    </div>
  )
}

export function TextareaField({ label, error, required, className = '', ...props }: TextareaFieldProps) {
  return (
    <div className="mb-4">
      <label className={formStyles.label}>
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      <textarea
        className={`${formStyles.textarea} min-h-[80px] ${className}`}
        {...props}
      />
      {error && <div className={formStyles.error}>{error}</div>}
    </div>
  )
}

export function SelectField({ label, error, required, className = '', children, ...props }: SelectFieldProps) {
  return (
    <div className="mb-4">
      <label className={formStyles.label}>
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      <select
        className={`${formStyles.select} ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && <div className={formStyles.error}>{error}</div>}
    </div>
  )
}