import { Link } from "@remix-run/react";
import type { OrderStatusCounts, QuoteStatusCounts } from "~/lib/dashboard";
import { statusStyles } from "~/utils/tw-styles";

interface StatusCardsProps {
  orderStatusCounts: OrderStatusCounts;
  quoteStatusCounts: QuoteStatusCounts;
  attentionCount: number;
}

interface StatusCardProps {
  label: string;
  count: number;
  href: string;
  statusStyle?: string;
}

function StatusCard({ label, count, href, statusStyle }: StatusCardProps) {
  return (
    <Link to={href} className="no-underline">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 hover:shadow-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-150 cursor-pointer border border-gray-200 dark:border-gray-700">
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
          {label}
        </div>
        <div className={`text-2xl font-bold ${statusStyle || "text-gray-900 dark:text-gray-100"}`}>
          {count}
        </div>
      </div>
    </Link>
  );
}

// Map order statuses to their display names and styles
const ORDER_STATUS_CONFIG: { key: keyof OrderStatusCounts; label: string; style: string }[] = [
  { key: "Pending", label: "Pending", style: statusStyles.pending },
  { key: "Waiting_For_Shop_Selection", label: "Waiting", style: statusStyles.waitingForShopSelection },
  { key: "In_Production", label: "In Production", style: statusStyles.inProduction },
  { key: "In_Inspection", label: "In Inspection", style: statusStyles.inInspection },
  { key: "Shipped", label: "Shipped", style: statusStyles.shipped },
  { key: "Delivered", label: "Delivered", style: statusStyles.delivered },
  { key: "Completed", label: "Completed", style: statusStyles.completed },
  { key: "Cancelled", label: "Cancelled", style: statusStyles.cancelled },
];

// Map quote statuses to their display names and styles
const QUOTE_STATUS_CONFIG: { key: keyof QuoteStatusCounts; label: string; style: string }[] = [
  { key: "RFQ", label: "RFQ", style: statusStyles.pending },
  { key: "Sent", label: "Sent", style: statusStyles.sent },
  { key: "Draft", label: "Draft", style: statusStyles.draft },
  { key: "Accepted", label: "Accepted", style: statusStyles.accepted },
  { key: "Rejected", label: "Rejected", style: statusStyles.rejected },
  { key: "Dropped", label: "Dropped", style: statusStyles.cancelled },
  { key: "Expired", label: "Expired", style: statusStyles.expired },
];

export default function StatusCards({ 
  orderStatusCounts, 
  quoteStatusCounts, 
  attentionCount 
}: StatusCardsProps) {
  // Calculate total active orders (excluding Completed and Cancelled)
  const activeOrders = ORDER_STATUS_CONFIG
    .filter(s => !["Completed", "Cancelled"].includes(s.key))
    .reduce((sum, s) => sum + orderStatusCounts[s.key], 0);

  // Calculate total active quotes
  const activeQuotes = QUOTE_STATUS_CONFIG
    .filter(s => !["Accepted", "Rejected", "Dropped", "Expired"].includes(s.key))
    .reduce((sum, s) => sum + quoteStatusCounts[s.key], 0);

  return (
    <div className="space-y-6">
      {/* Orders Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Orders
          </h3>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {activeOrders} active
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {ORDER_STATUS_CONFIG.map((status) => (
            <StatusCard
              key={status.key}
              label={status.label}
              count={orderStatusCounts[status.key]}
              href={`/orders?status=${status.key}`}
              statusStyle={status.style}
            />
          ))}
        </div>
      </div>

      {/* Quotes Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Quotes
          </h3>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {activeQuotes} active
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {QUOTE_STATUS_CONFIG.map((status) => (
            <StatusCard
              key={status.key}
              label={status.label}
              count={quoteStatusCounts[status.key]}
              href={`/quotes?status=${status.key}`}
              statusStyle={status.style}
            />
          ))}
        </div>
      </div>

      {/* Attention Banner */}
      {attentionCount > 0 && (
        <Link to="/ActionItems" className="no-underline block">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors duration-150 cursor-pointer">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <div className="font-semibold text-amber-800 dark:text-amber-200">
                    Attention Required
                  </div>
                  <div className="text-sm text-amber-600 dark:text-amber-400">
                    {attentionCount} order{attentionCount !== 1 ? "s" : ""} need{attentionCount === 1 ? "s" : ""} your review
                  </div>
                </div>
              </div>
              <div className="text-amber-600 dark:text-amber-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </div>
        </Link>
      )}
    </div>
  );
}
