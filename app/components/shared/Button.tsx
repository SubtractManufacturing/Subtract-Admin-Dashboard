import type { ButtonHTMLAttributes, ReactNode } from "react"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
}

export default function Button({ 
  variant = 'primary', 
  size = 'md', 
  className = '', 
  children, 
  ...props 
}: ButtonProps) {
  const baseClasses = 'font-weight-600 border-radius-5px transition-all cursor-pointer border-none'
  
  const variantClasses = {
    primary: 'background-color-#1f2937 color-white hover:opacity-0.8',
    secondary: 'background-color-white color-#1f2937 border-1px-solid-#1f2937 hover:background-color-#f7f7f7',
    danger: 'background-color-#dc2626 color-white hover:opacity-0.8'
  }
  
  const sizeClasses = {
    sm: 'padding-6px-12px font-size-14px',
    md: 'padding-8px-16px font-size-16px',
    lg: 'padding-12px-24px font-size-18px'
  }

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      style={{
        fontWeight: 600,
        borderRadius: '5px',
        transition: 'all 0.2s',
        cursor: 'pointer',
        border: variant === 'secondary' ? '1px solid #1f2937' : 'none',
        backgroundColor: variant === 'primary' ? '#1f2937' : variant === 'danger' ? '#dc2626' : 'white',
        color: variant === 'secondary' ? '#1f2937' : 'white',
        padding: size === 'sm' ? '6px 12px' : size === 'lg' ? '12px 24px' : '8px 16px',
        fontSize: size === 'sm' ? '14px' : size === 'lg' ? '18px' : '16px'
      }}
      {...props}
    >
      {children}
    </button>
  )
}