// Common Tailwind style patterns for the application

export const tableStyles = {
  container: "w-full border-collapse bg-white shadow-md rounded-lg overflow-hidden",
  header: "bg-gray-50",
  headerCell: "px-4 py-3 text-left font-semibold text-gray-700 border-b border-gray-200",
  row: "hover:bg-gray-50 transition-colors",
  cell: "px-4 py-3 text-left border-b border-gray-200",
  emptyState: "text-center py-10 text-gray-500"
}

export const statusStyles = {
  base: "font-bold",
  pending: "text-status-pending",
  accepted: "text-status-accepted",
  rejected: "text-status-rejected",
  draft: "text-status-draft",
  sent: "text-status-sent",
  expired: "text-status-expired",
  inProduction: "text-status-in-production",
  completed: "text-status-completed",
  cancelled: "text-status-cancelled",
  archived: "text-status-archived italic"
}

export const cardStyles = {
  container: "bg-white border border-gray-400 rounded-lg p-5 shadow-md transition-transform hover:scale-105 hover:bg-gray-50",
  title: "text-4xl font-bold text-black",
  subtitle: "mt-6 mb-3 text-gray-700",
  content: "font-semibold text-gray-500"
}

export const modalStyles = {
  overlay: "fixed inset-0 bg-black/50 flex items-center justify-center z-50",
  content: "bg-white rounded-lg p-6 max-w-lg w-full mx-4",
  header: "flex justify-between items-center mb-4",
  title: "text-xl font-semibold",
  closeButton: "text-gray-500 hover:text-gray-700 text-2xl leading-none"
}

export const formStyles = {
  label: "block text-sm font-medium text-gray-700 mb-1",
  input: "w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500",
  textarea: "w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-vertical",
  select: "w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white",
  error: "text-red-600 text-sm mt-1"
}