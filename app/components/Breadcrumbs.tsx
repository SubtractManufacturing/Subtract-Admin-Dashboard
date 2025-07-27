import { Link } from "@remix-run/react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <div className="font-semibold text-gray-600 dark:text-gray-400 text-sm transition-colors duration-150">
      {items.map((item, index) => (
        <span key={index}>
          {item.href ? (
            <Link 
              to={item.href} 
              className="hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-gray-900 dark:text-gray-200">{item.label}</span>
          )}
          {index < items.length - 1 && <span className="mx-2">/</span>}
        </span>
      ))}
    </div>
  );
}