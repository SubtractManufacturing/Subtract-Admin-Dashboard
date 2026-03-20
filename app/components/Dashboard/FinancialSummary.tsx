import type { FinancialSummary as FinancialSummaryType } from "~/lib/dashboard";

interface FinancialSummaryProps {
  financials: FinancialSummaryType;
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(amount);
};

export default function FinancialSummary({ financials }: FinancialSummaryProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
        <span>💰</span> Financial Summary
      </h2>
      
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {/* Open PO Revenue */}
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
            Open PO Revenue
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {formatCurrency(financials.openPoRevenue)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Active orders pending completion
          </div>
        </div>
        
        {/* Pipeline Value */}
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
            Pipeline Value
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {formatCurrency(financials.pipelineValue)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Active quotes (RFQ, Draft, Sent)
          </div>
        </div>
        
        {/* Needs Attention */}
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800">
          <div className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-1">
            Needs Attention
          </div>
          <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">
            {financials.attentionCount}
          </div>
          <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            Orders pending review
          </div>
        </div>
      </div>
    </div>
  );
}
