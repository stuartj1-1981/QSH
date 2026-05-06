import { memo } from 'react'
import { Zap, PiggyBank, TrendingDown, History } from 'lucide-react'
import { costLabelFor } from '../lib/sourceLabels'

interface TodaySummaryProps {
  costTodayPence: number
  costYesterdayPence?: number
  energyTodayKwh: number
  currentRate: number
  predictedSaving?: number
  predictedEnergySaving?: number
  // INSTRUCTION-150E Task 5: install-topology-aware labelling. The Home
  // page passes the active heat-source type (from
  // source_selection.active_source or the single heat_source.type) and the
  // count of physical primary heat sources from the install config.
  // V2 E-H2: count of physical heat sources, NOT fuels in use. A
  // gas-boiler-with-electric-immersion install has heatSourceCount == 1
  // (just the boiler) but tariff_providers_status has two keys
  // (electricity + gas, immersion is backup). The latter would mislabel
  // as "Heating cost today" when "Gas cost today" is right.
  activeSource?: string | null
  heatSourceCount?: number
}

export const TodaySummary = memo(function TodaySummary({
  costTodayPence,
  costYesterdayPence,
  energyTodayKwh,
  currentRate,
  predictedSaving,
  predictedEnergySaving,
  activeSource,
  heatSourceCount = 1,
}: TodaySummaryProps) {
  const costLabel = costLabelFor(activeSource, heatSourceCount)
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 mb-4">
      <SummaryCard
        icon={<PiggyBank size={18} className="text-[var(--green)]" />}
        label={costLabel}
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
