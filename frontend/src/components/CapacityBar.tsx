import { memo } from 'react'

interface CapacityBarProps {
  capacityPct: number
  minLoadPct: number
}

function barColor(pct: number): string {
  if (pct > 100) return 'var(--red)'
  if (pct >= 80) return 'var(--amber)'
  return 'var(--green)'
}

function contextualHint(capacityPct: number, minLoadPct: number): string {
  if (capacityPct < 1) return 'All rooms at target'
  if (capacityPct < minLoadPct) return 'Below start threshold'
  if (capacityPct >= 80) return 'High demand'
  return 'System heating'
}

export const CapacityBar = memo(function CapacityBar({ capacityPct, minLoadPct }: CapacityBarProps) {
  const color = barColor(capacityPct)
  const fillWidth = Math.min(capacityPct, 100)

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--text-muted)]">Home Heat Demand</span>
        <span className="text-xs font-semibold" style={{ color }}>
          {capacityPct.toFixed(0)}%
        </span>
      </div>
      <div className="relative">
        {/* Min load label */}
        {minLoadPct > 0 && (
          <div
            className="absolute -top-4 text-[9px] text-[var(--text-muted)] whitespace-nowrap -translate-x-1/2"
            style={{ left: `clamp(8%, ${Math.min(minLoadPct, 100)}%, 92%)` }}
          >
            Minimum HP demand
          </div>
        )}
        <div className="h-3 mt-4 rounded-full bg-gray-200 dark:bg-gray-700 relative">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${fillWidth}%`, backgroundColor: color }}
          />
          {/* Min load threshold marker */}
          {minLoadPct > 0 && (
            <div
              className="absolute -top-1 h-[calc(100%+8px)] w-1 rounded-full bg-[var(--text-muted)]"
              style={{ left: `${Math.min(minLoadPct, 100)}%` }}
              title={`System starts at ${minLoadPct.toFixed(0)}%`}
            />
          )}
        </div>
      </div>
      <div className="text-[10px] text-[var(--text-muted)] mt-1">
        {contextualHint(capacityPct, minLoadPct)}
      </div>
    </div>
  )
})
