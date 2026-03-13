import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

interface AdminButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, AdminButtonProps>(
  ({ variant = "primary", size = "md", className = "", children, ...props }, ref) => {
    const base = "inline-flex items-center justify-center font-semibold rounded transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

    const variants = {
      primary:
        "bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200 border border-transparent",
      secondary:
        "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-transparent dark:text-gray-200 dark:border-gray-600 dark:hover:bg-slate-700/40",
      danger:
        "bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 border border-transparent",
    };

    const sizes = {
      sm: "px-3 py-1.5 text-sm",
      md: "px-4 py-2 text-sm",
      lg: "px-6 py-3 text-base",
    };

    return (
      <button
        ref={ref}
        className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "AdminButton";

export default Button;
