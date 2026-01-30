import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getDashboardStats, getOrders, getQuotes } from "~/lib/dashboard";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";

import SearchHeader from "~/components/SearchHeader";
import StatCards from "~/components/StatCards";
import OrdersTable from "~/components/OrdersTable";
import QuotesTable from "~/components/QuotesTable";

export async function loader({ request }: LoaderFunctionArgs) {
  const { headers } = await requireAuth(request);
  const url = new URL(request.url);
  const rfqDays = Number(url.searchParams.get("rfqPeriod")) || 30;

  try {
    const [stats, orders, quotes] = await Promise.all([
      getDashboardStats(rfqDays),
      getOrders(),
      getQuotes(),
    ]);

    return withAuthHeaders(
      json({ stats, orders, quotes }),
      headers
    );
  } catch (error) {
    console.error("Dashboard loader error:", error);
    return withAuthHeaders(
      json({
        stats: { actionItems: 0, openPoRevenue: 0, openPOs: 0, rfqs: 0 },
        orders: [],
        quotes: [],
      }),
      headers
    );
  }
}

export default function Index() {
  const { stats, orders, quotes } = useLoaderData<typeof loader>();

  return (
    <div className="max-w-[1920px] mx-auto">
      <SearchHeader breadcrumbs={[{ label: "Dashboard" }]} />
      <StatCards stats={stats} />
      <OrdersTable orders={orders} />
      <QuotesTable quotes={quotes} />
    </div>
  );
}
