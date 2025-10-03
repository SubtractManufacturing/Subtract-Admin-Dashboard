/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'navbar-bg': '#1f2937',
        'status-pending': '#f97316',
        'status-accepted': '#10b981',
        'status-rejected': '#ef4444',
        'status-draft': '#6b7280',
        'status-sent': '#3b82f6',
        'status-expired': '#ef4444',
        'status-waiting-for-shop-selection': '#a855f7',
        'status-in-production': '#3b82f6',
        'status-in-inspection': '#f59e0b',
        'status-shipped': '#14b8a6',
        'status-delivered': '#22c55e',
        'status-completed': '#10b981',
        'status-cancelled': '#ef4444',
        'status-archived': '#666666',
      }
    },
  },
  plugins: [],
}