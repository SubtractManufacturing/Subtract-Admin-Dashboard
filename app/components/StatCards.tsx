import { Link } from "@remix-run/react";
import type { DashboardStats } from "~/lib/dashboard";
import { cardStyles } from "~/utils/tw-styles";

interface StatCardsProps {
  stats: DashboardStats;
}

export default function StatCards({ stats }: StatCardsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
      <Link to="/ActionItems" className="no-underline">
        <div
          className={`${cardStyles.container} cursor-pointer h-full flex flex-col`}
        >
          <h4 className={cardStyles.subtitle}>Action Items</h4>
          <h1 className={cardStyles.title}>{stats.actionItems}</h1>
          <p className={cardStyles.content}>Requires review</p>
        </div>
      </Link>
      <div className={`${cardStyles.container} h-full flex flex-col`}>
        <h4 className={cardStyles.subtitle}>Open PO Revenue</h4>
        <h1 className={cardStyles.title}>
          {formatCurrency(stats.openPoRevenue)}
        </h1>
      </div>
      <Link to="/orders" className="no-underline">
        <div
          className={`${cardStyles.container} cursor-pointer h-full flex flex-col`}
        >
          <h4 className={cardStyles.subtitle}>Open PO&apos;s</h4>
          <h1 className={cardStyles.title}>{stats.openPOs}</h1>
        </div>
      </Link>
      <div className={`${cardStyles.container} h-full flex flex-col`}>
        <h4 className={cardStyles.subtitle}>Quotes</h4>
        <h1 className={cardStyles.title}>{stats.rfqs}</h1>
      </div>
    </div>
  );
}
