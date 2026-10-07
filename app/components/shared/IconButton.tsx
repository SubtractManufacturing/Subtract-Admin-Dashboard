import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  variant?: "default" | "danger";
}

const variantClasses = {
  default:
    "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/50",
  danger:
    "text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20",
} as const;

export function IconButton({
  icon,
  variant = "default",
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      className={`p-2 rounded transition-colors duration-150 ${variantClasses[variant]} ${className ?? ""}`}
      {...props}
    >
      {icon}
    </button>
  );
}
