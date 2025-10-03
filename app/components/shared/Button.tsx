import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}, ref) => {
  const baseClasses = 'font-semibold rounded transition-all cursor-pointer'

  const variantClasses = {
    primary: 'bg-gray-800 dark:bg-transparent text-white dark:text-blue-400 hover:bg-gray-900 dark:hover:bg-blue-950/30 border border-transparent dark:border-blue-600',
    secondary: 'bg-white dark:bg-transparent text-gray-800 dark:text-gray-200 border border-gray-800 dark:border-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/30',
    danger: 'bg-red-600 dark:bg-transparent text-white dark:text-red-400 hover:bg-red-700 dark:hover:bg-red-950/30 border border-transparent dark:border-red-600'
  }

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg'
  }

  return (
    <button
      ref={ref}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
})

Button.displayName = 'Button'

export default Button