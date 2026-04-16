import { memo } from 'react'
import { Zap, PiggyBank, TrendingDown, History } from 'lucide-react'

interface TodaySummaryProps {
  costTodayPence: number
  costYesterdayPence?: number
  energyTodayKwh: number
  currentRate: number
  predictedSaving?: number
  predictedEnergySaving?: number
}

export const TodaySummary = memo(function TodaySummary({
  costTodayPence,
  costYesterdayPence,
  energyTodayKwh,
  currentRate,
  predictedSaving,
  predictedEnergySaving,
}: TodaySummaryProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      <SummaryCard
        icon={<PiggyBank size={18} className="text-[var(--green)]" />}
        label="Cost today"
        value={`${costTodayPence.toFixed(0)}p`}
      />
      {costYesterdayPence != null && costYesterdayPence > 0 && (
        <SummaryCard
          icon={<History size={18} className="text-[var(--text-muted)]" />}
          label="Cost yesterday"
          value={`${costYesterdayPence.toFixed(0)}p`}
        />
      )}
      <SummaryCard
        icon={<Zap size={18} className="text-[var(--amber)]" />}
        label="Energy today"
        value={`${energyTodayKwh.toFixed(1)} kWh`}
      />
      <SummaryCard
        icon={<Zap size={18} className="text-[var(--blue)]" />}
        label="Current rate"
        value={`${(currentRate * 100).toFixed(2)}p/kWh`}
      />
      {predictedSaving !== undefined && (
        <SummaryCard
          icon={<TrendingDown size={18} className="text-[var(--green)]" />}
          label="Predicted saving"
          value={`${predictedSaving.toFixed(0)}%`}
        />
      )}
      {predictedEnergySaving != null && predictedEnergySaving > 0 && (
        <SummaryCard
          icon={<TrendingDown size={18} className="text-[var(--accent)]" />}
          label="Energy saving"
          value={`${predictedEnergySaving.toFixed(1)} kWh`}
        />
      )}
    </div>
  )
})

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-[var(--text-muted)]">{label}</span>
      </div>
      <div className="text-base sm:text-lg font-semibold">{value}</div>
    </div>
  )
}
