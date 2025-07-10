import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getDashboardStats, getOrders, getQuotes } from "~/lib/dashboard";

import Navbar from "~/components/Navbar";
import SearchHeader from "~/components/SearchHeader";
import StatCards from "~/components/StatCards";
import OrdersTable from "~/components/OrdersTable";
import QuotesTable from "~/components/QuotesTable";

export async function loader() {
  try {
    const [stats, orders, quotes] = await Promise.all([
      getDashboardStats(),
      getOrders(),
      getQuotes(),
    ]);

    return json({ stats, orders, quotes });
  } catch (error) {
    console.error("Dashboard loader error:", error);
    return json({
      stats: { actionItems: 0, openPoRevenue: 0, openPOs: 0, rfqs: 0 },
      orders: [],
      quotes: [],
    });
  }
}

export default function Index() {
  const { stats, orders, quotes } = useLoaderData<typeof loader>();

  return (
    <div>
      <Navbar />
      <SearchHeader breadcrumbs="Dashboard" />
      <StatCards stats={stats} />
      <OrdersTable orders={orders} />
      <QuotesTable quotes={quotes} />
    </div>
  );
}
