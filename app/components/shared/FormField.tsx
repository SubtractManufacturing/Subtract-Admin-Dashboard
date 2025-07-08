import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react"

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

const fieldStyles = {
  container: {
    marginBottom: '16px'
  },
  label: {
    display: 'block',
    marginBottom: '4px',
    fontWeight: 600,
    fontSize: '14px',
    color: '#374151'
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid Gray',
    borderRadius: '5px',
    fontSize: '14px',
    fontFamily: '"Inter", sans-serif'
  },
  error: {
    color: '#dc2626',
    fontSize: '12px',
    marginTop: '4px'
  },
  required: {
    color: '#dc2626'
  }
}

export function InputField({ label, error, required, className = '', ...props }: InputFieldProps) {
  return (
    <div style={fieldStyles.container}>
      <label style={fieldStyles.label}>
        {label}
        {required && <span style={fieldStyles.required}> *</span>}
      </label>
      <input
        style={fieldStyles.input}
        className={className}
        {...props}
      />
      {error && <div style={fieldStyles.error}>{error}</div>}
    </div>
  )
}

export function TextareaField({ label, error, required, className = '', ...props }: TextareaFieldProps) {
  return (
    <div style={fieldStyles.container}>
      <label style={fieldStyles.label}>
        {label}
        {required && <span style={fieldStyles.required}> *</span>}
      </label>
      <textarea
        style={{ ...fieldStyles.input, minHeight: '80px', resize: 'vertical' }}
        className={className}
        {...props}
      />
      {error && <div style={fieldStyles.error}>{error}</div>}
    </div>
  )
}

export function SelectField({ label, error, required, className = '', children, ...props }: SelectFieldProps) {
  return (
    <div style={fieldStyles.container}>
      <label style={fieldStyles.label}>
        {label}
        {required && <span style={fieldStyles.required}> *</span>}
      </label>
      <select
        style={fieldStyles.input}
        className={className}
        {...props}
      >
        {children}
      </select>
      {error && <div style={fieldStyles.error}>{error}</div>}
    </div>
  )
}