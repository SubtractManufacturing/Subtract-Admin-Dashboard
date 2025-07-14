import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getDashboardStats, getOrders, getQuotes } from "~/lib/dashboard.js";

import Navbar from "~/components/Navbar.js";
import SearchHeader from "~/components/SearchHeader.js";
import StatCards from "~/components/StatCards.js";
import OrdersTable from "~/components/OrdersTable.js";
import QuotesTable from "~/components/QuotesTable.js";

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
      <div className="max-w-[1920px] mx-auto">
        <SearchHeader breadcrumbs="Dashboard" />
        <StatCards stats={stats} />
        <OrdersTable orders={orders} />
        <QuotesTable quotes={quotes} />
      </div>
    </div>
  );
}
