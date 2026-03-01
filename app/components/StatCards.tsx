import { Link, useSearchParams, useSubmit } from "@remix-run/react";
import type { DashboardStats } from "~/lib/dashboard";
import { cardStyles } from "~/utils/tw-styles";

interface StatCardsProps {
  stats: DashboardStats;
}

export default function StatCards({ stats }: StatCardsProps) {
  const [searchParams] = useSearchParams();
  const submit = useSubmit();
  const rfqPeriod = searchParams.get("rfqPeriod") || "30";

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const handlePeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = e.target.value;
    const newParams = new URLSearchParams(searchParams);
    newParams.set("rfqPeriod", newValue);
    submit(newParams, {
      method: "get",
      preventScrollReset: true,
      replace: true,
    });
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
        <div className="flex items-center gap-2">
          <p className={cardStyles.content}>In the Last:</p>
          <select
            value={rfqPeriod}
            onChange={handlePeriodChange}
            className="font-semibold text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-150"
          >
            <option value="30">30 Days</option>
            <option value="14">14 Days</option>
            <option value="7">7 Days</option>
            <option value="1">Today</option>
          </select>
        </div>
      </div>
    </div>
  );
}
