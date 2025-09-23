import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getDashboardStats, getOrders, getQuotes } from "~/lib/dashboard";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAppConfig } from "~/lib/config.server";
import { shouldShowEventsInNav } from "~/lib/featureFlags";

import Navbar from "~/components/Navbar";
import SearchHeader from "~/components/SearchHeader";
import StatCards from "~/components/StatCards";
import OrdersTable from "~/components/OrdersTable";
import QuotesTable from "~/components/QuotesTable";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();

  try {
    const [stats, orders, quotes, showEventsLink] = await Promise.all([
      getDashboardStats(),
      getOrders(),
      getQuotes(),
      shouldShowEventsInNav(),
    ]);

    return withAuthHeaders(
      json({ stats, orders, quotes, user, userDetails, appConfig, showEventsLink }),
      headers
    );
  } catch (error) {
    console.error("Dashboard loader error:", error);
    return withAuthHeaders(
      json({
        stats: { actionItems: 0, openPoRevenue: 0, openPOs: 0, rfqs: 0 },
        orders: [],
        quotes: [],
        user,
        userDetails,
        appConfig,
        showEventsLink: true,
      }),
      headers
    );
  }
}

export default function Index() {
  const { stats, orders, quotes, user, userDetails, appConfig, showEventsLink } = useLoaderData<typeof loader>();

  return (
    <div>
      <Navbar
        userName={userDetails?.name || user.email}
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
        version={appConfig.version}
        isStaging={appConfig.isStaging}
        showEventsLink={showEventsLink}
      />
      <div className="max-w-[1920px] mx-auto">
        <SearchHeader breadcrumbs={[{ label: "Dashboard" }]} />
        <StatCards stats={stats} />
        <OrdersTable orders={orders} />
        <QuotesTable quotes={quotes} />
      </div>
    </div>
  );
}
