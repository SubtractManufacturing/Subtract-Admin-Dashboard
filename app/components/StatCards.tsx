import { useState } from "react"
import type { DashboardStats } from "~/lib/dashboard"

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
    <div className="flex-container">
      <div className="card">
        <h4>Action Items</h4>
        <h1 className="card-h1">{stats.actionItems}</h1>
        <p>Requires review</p>
      </div>
      <div className="card">
        <h4>Open PO Revenue</h4>
        <h1 className="card-h1">{formatCurrency(stats.openPoRevenue)}</h1>
        <p>+81% month over month</p>
      </div>
      <div className="card">
        <h4>Open PO's</h4>
        <h1 className="card-h1">{stats.openPOs}</h1>
        <p>+33% month over month</p>
      </div>
      <div className="card">
        <h4>RFQ's</h4>
        <h1 className="card-h1">{stats.rfqs}</h1>
        <div className="sidebyside">
          <p>In the Last:</p>
          <select 
            value={rfqPeriod} 
            onChange={(e) => setRfqPeriod(e.target.value)}
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