// Common Tailwind style patterns for the application

export const tableStyles = {
  container: "w-full border-collapse bg-white dark:bg-gray-800 shadow-md rounded-lg overflow-hidden transition-colors duration-150",
  header: "bg-gray-50 dark:bg-gray-700 transition-colors duration-150",
  headerCell: "px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200 border-b border-gray-200 dark:border-gray-600 transition-colors duration-150",
  row: "hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150",
  cell: "px-4 py-3 text-left border-b border-gray-200 dark:border-gray-600 transition-colors duration-150",
  emptyState: "text-center py-10 text-gray-500 dark:text-gray-400 transition-colors duration-150"
}

export const statusStyles = {
  base: "font-bold",
  pending: "text-status-pending",
  accepted: "text-status-accepted",
  rejected: "text-status-rejected",
  draft: "text-status-draft",
  sent: "text-status-sent",
  expired: "text-status-expired",
  waitingForShopSelection: "text-status-waiting-for-shop-selection",
  inProduction: "text-status-in-production",
  inInspection: "text-status-in-inspection",
  shipped: "text-status-shipped",
  delivered: "text-status-delivered",
  completed: "text-status-completed",
  cancelled: "text-status-cancelled",
  archived: "text-status-archived italic"
}

export const cardStyles = {
  container: "bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md transition-all duration-150 hover:scale-105 hover:bg-gray-50 dark:hover:bg-gray-700",
  title: "text-4xl font-bold text-black dark:text-white transition-colors duration-150",
  subtitle: "text-gray-700 dark:text-gray-300 mb-2 transition-colors duration-150",
  content: "font-semibold text-gray-500 dark:text-gray-400 transition-colors duration-150"
}

export const listCardStyles = {
  grid: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4",
  card: "bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 border border-gray-200 dark:border-gray-700 transition-colors duration-150",
  clickableCard: "cursor-pointer hover:shadow-lg",
  header: "flex items-start justify-between gap-3 mb-3",
  title: "text-lg font-semibold text-gray-900 dark:text-gray-100",
  sectionGrid: "grid grid-cols-2 gap-3",
  label: "text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide",
  value: "text-sm text-gray-900 dark:text-gray-100 mt-0.5",
  actionRow: "flex items-center gap-2 mt-4 pt-3 border-t border-gray-200 dark:border-gray-700"
}

export const modalStyles = {
  overlay: "fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 transition-colors duration-150",
  content: "bg-white dark:bg-gray-800 rounded-lg p-6 max-w-lg w-full mx-4 transition-colors duration-150",
  header: "flex justify-between items-center mb-4",
  title: "text-xl font-semibold dark:text-white transition-colors duration-150",
  closeButton: "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none transition-colors duration-150"
}

export const formStyles = {
  label: "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 transition-colors duration-150",
  input: "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:text-white transition-colors duration-150",
  textarea: "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-vertical bg-white dark:bg-gray-700 dark:text-white transition-colors duration-150",
  select: "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:text-white transition-colors duration-150",
  error: "text-red-600 dark:text-red-400 text-sm mt-1 transition-colors duration-150"
}

export const buttonStyles = {
  primary: "bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150",
  secondary: "bg-gray-500 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150",
  danger: "bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
}

// Combined styles export for convenience
export const styles = {
  table: tableStyles,
  status: statusStyles,
  card: cardStyles,
  listCard: listCardStyles,
  modal: modalStyles,
  form: formStyles,
  button: buttonStyles
}