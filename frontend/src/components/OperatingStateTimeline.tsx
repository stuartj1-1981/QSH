import { memo } from 'react'
import type { HistoryPoint } from '../hooks/useHistory'

interface OperatingStateTimelineProps {
  data: HistoryPoint[]
  hours: number
}

function getStateColor(state: string): string {
  const s = state.toLowerCase()

  // Winter family — blue
  if (s.startsWith('winter')) {
    if (s.includes('equilibrium')) return '#60a5fa'
    if (s.includes('hw')) return '#93c5fd'
    return '#3b82f6'
  }

  // Shoulder family — semantic strategy colours
  if (s.startsWith('shoulder')) {
    if (s.includes('heating')) return '#ef4444'
    if (s.includes('monitoring')) return '#22c55e'
    if (s.includes('hw')) return '#f59e0b'
    if (s.includes('defrost') || s.includes('oil')) return '#8b5cf6'
    if (s.includes('short cycle')) return '#f97316'
    return '#6b7280'
  }

  // Summer family — cyan
  if (s.startsWith('summer')) {
    if (s.includes('hw')) return '#22d3ee'
    return '#06b6d4'
  }

  // Non-mode states
  if (s === 'monitoring only') return '#6b7280'

  return '#6b7280'
}

export const OperatingStateTimeline = memo(function OperatingStateTimeline({ data, hours }: OperatingStateTimelineProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 mb-4">
        <h3 className="text-sm font-semibold mb-2">Operating State ({hours}h)</h3>
        <div className="text-xs text-[var(--text-muted)] text-center py-8">
          No history data yet — collecting...
        </div>
      </div>
    )
  }

  const minT = data[0].t as number
  const maxT = data[data.length - 1].t as number
  const range = maxT - minT || 1

  // Build segments
  const segments: { start: number; end: number; state: string }[] = []
  for (let i = 0; i < data.length; i++) {
    const state = String(data[i].operating_state ?? '')
    const t = data[i].t as number
    const nextT = i < data.length - 1 ? (data[i + 1].t as number) : maxT

    if (segments.length > 0 && segments[segments.length - 1].state === state) {
      segments[segments.length - 1].end = nextT
    } else {
      segments.push({ start: t, end: nextT, state })
    }
  }

  // Unique states for legend
  const uniqueStates = [...new Set(segments.map(s => s.state))]

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 mb-4">
      <h3 className="text-sm font-semibold mb-2">Operating State ({hours}h)</h3>
      <div className="h-6 rounded-md overflow-hidden flex">
        {segments.map((seg, i) => {
          const width = ((seg.end - seg.start) / range) * 100
          return (
            <div
              key={i}
              style={{ width: `${width}%`, backgroundColor: getStateColor(seg.state) }}
              title={seg.state}
              className="h-full min-w-[1px]"
            />
          )
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {uniqueStates.map(state => (
          <div key={state} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: getStateColor(state) }}
            />
            {state}
          </div>
        ))}
      </div>
    </div>
  )
})
