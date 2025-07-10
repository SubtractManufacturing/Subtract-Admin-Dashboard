import { useState } from "react"
import type { DashboardStats } from "~/lib/dashboard"
import { cardStyles } from "~/utils/tw-styles"

interface StatCardsProps {
  stats: DashboardStats
}

export default function StatCards({ stats }: StatCardsProps) {
  const [rfqPeriod, setRfqPeriod] = useState("30")

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  const getMonthOverMonthPercentage = (current: number, previous: number) => {
    if (previous === 0) return "+100%"
    const percentage = ((current - previous) / previous) * 100
    return percentage > 0 ? `+${percentage.toFixed(0)}%` : `${percentage.toFixed(0)}%`
  }

  return (
    <div className="flex justify-center gap-5 flex-wrap px-10 py-5">
      <div className={`${cardStyles.container} flex-grow max-w-xs min-w-[200px]`}>
        <h4 className={cardStyles.subtitle}>Action Items</h4>
        <h1 className={cardStyles.title}>{stats.actionItems}</h1>
        <p className={cardStyles.content}>Requires review</p>
      </div>
      <div className={`${cardStyles.container} flex-grow max-w-xs min-w-[200px]`}>
        <h4 className={cardStyles.subtitle}>Open PO Revenue</h4>
        <h1 className={cardStyles.title}>{formatCurrency(stats.openPoRevenue)}</h1>
        <p className={cardStyles.content}>+81% month over month</p>
      </div>
      <div className={`${cardStyles.container} flex-grow max-w-xs min-w-[200px]`}>
        <h4 className={cardStyles.subtitle}>Open PO's</h4>
        <h1 className={cardStyles.title}>{stats.openPOs}</h1>
        <p className={cardStyles.content}>+33% month over month</p>
      </div>
      <div className={`${cardStyles.container} flex-grow max-w-xs min-w-[200px]`}>
        <h4 className={cardStyles.subtitle}>RFQ's</h4>
        <h1 className={cardStyles.title}>{stats.rfqs}</h1>
        <div className="flex items-center gap-2">
          <p className={cardStyles.content}>In the Last:</p>
          <select 
            value={rfqPeriod} 
            onChange={(e) => setRfqPeriod(e.target.value)}
            className="font-semibold text-gray-500 bg-white border border-gray-400 rounded px-4 py-1 text-sm"
          >
            <option value="30">30 Days</option>
            <option value="14">14 Days</option>
            <option value="7">7 Days</option>
            <option value="1">Today</option>
          </select>
        </div>
      </div>
    </div>
  )
}