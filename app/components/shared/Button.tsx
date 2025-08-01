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
  const baseClasses = 'font-semibold rounded transition-all cursor-pointer'
  
  const variantClasses = {
    primary: 'bg-gray-800 dark:bg-gray-700 text-white hover:opacity-80 border-0',
    secondary: 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-800 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700',
    danger: 'bg-red-600 dark:bg-red-700 text-white hover:opacity-80 border-0'
  }
  
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg'
  }

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}