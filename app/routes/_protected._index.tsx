import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { 
  getDashboardStats, 
  getOrders, 
  getQuotes, 
  getOrderStatusCounts, 
  getQuoteStatusCounts, 
  getFinancialSummary,
  type TimeRangeValue 
} from "~/lib/dashboard";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { parseTimeRange } from "~/components/TimeRangeSelector";

import SearchHeader from "~/components/SearchHeader";
import TimeRangeSelector from "~/components/TimeRangeSelector";
import StatusCards from "~/components/Dashboard/StatusCards";
import OrdersTable from "~/components/OrdersTable";
import QuotesTable from "~/components/QuotesTable";

export async function loader({ request }: LoaderFunctionArgs) {
  const { headers } = await requireAuth(request);
  const url = new URL(request.url);
  const range = parseTimeRange(url.searchParams.get("range"));

  try {
    const [stats, orders, quotes, orderStatusCounts, quoteStatusCounts, financials] = await Promise.all([
      getDashboardStats(range),
      getOrders(10),
      getQuotes(10),
      getOrderStatusCounts(),
      getQuoteStatusCounts(),
      getFinancialSummary(),
    ]);

    return withAuthHeaders(
      json({ 
        stats, 
        orders, 
        quotes, 
        orderStatusCounts, 
        quoteStatusCounts, 
        financials,
        range 
      }),
      headers
    );
  } catch (error) {
    console.error("Dashboard loader error:", error);
    return withAuthHeaders(
      json({
        stats: { actionItems: 0, openPoRevenue: 0, openPOs: 0, rfqs: 0 },
        orders: [],
        quotes: [],
        orderStatusCounts: {
          Pending: 0,
          Waiting_For_Shop_Selection: 0,
          In_Production: 0,
          In_Inspection: 0,
          Shipped: 0,
          Delivered: 0,
          Completed: 0,
          Cancelled: 0,
        },
        quoteStatusCounts: {
          RFQ: 0,
          Draft: 0,
          Sent: 0,
          Accepted: 0,
          Rejected: 0,
          Dropped: 0,
          Expired: 0,
        },
        financials: { openPoRevenue: 0, pipelineValue: 0, attentionCount: 0 },
        range: "30d" as TimeRangeValue,
      }),
      headers
    );
  }
}

export default function Index() {
  const { stats, orders, quotes, orderStatusCounts, quoteStatusCounts, financials, range } = useLoaderData<typeof loader>();

  return (
    <div className="max-w-[1920px] mx-auto">
      <SearchHeader breadcrumbs={[{ label: "Dashboard" }]} />
      
      {/* Global Time Range Selector */}
      <div className="px-4 sm:px-6 lg:px-10 py-4 flex justify-end">
        <TimeRangeSelector />
      </div>
      
      {/* Status Cards Section */}
      <div className="px-4 sm:px-6 lg:px-10">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <span>📊</span> Status at a Glance
          </h2>
          <StatusCards 
            orderStatusCounts={orderStatusCounts}
            quoteStatusCounts={quoteStatusCounts}
            attentionCount={financials.attentionCount}
          />
        </div>
      </div>
      
      <OrdersTable orders={orders} />
      <QuotesTable quotes={quotes} />
      
      {/* Financial Summary */}
      <div className="px-4 sm:px-6 lg:px-10 pb-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <span>💰</span> Financial Summary
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                Open PO Revenue
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                }).format(financials.openPoRevenue)}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                Pipeline Value
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                }).format(financials.pipelineValue)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Active quotes (RFQ, Draft, Sent)
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                Needs Attention
              </div>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {financials.attentionCount}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Pending + Waiting for Shop
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
