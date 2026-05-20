import { memo, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { HistoryPoint } from '../hooks/useHistory'
import { computePopoverCoords, type PopoverCoords } from '../lib/popover'

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

  // Shadow family — desaturated equivalents of the live colours,
  // signalling "what we would do" rather than "what we are doing".
  if (s.startsWith('shadow')) {
    if (s.includes('hw')) return '#94a3b8'           // slate-400
    if (s.includes('defrost') || s.includes('oil')) return '#a78bfa' // violet-400
    if (s.includes('short cycle')) return '#fb923c'  // orange-400
    if (s.includes('equilibrium')) return '#7dd3fc'  // sky-300
    if (s.includes('heating')) return '#9ca3af'      // gray-400
    if (s.includes('monitoring')) return '#6b7280'   // gray-500
    return '#6b7280'
  }

  // Non-mode states
  if (s === 'monitoring only') return '#6b7280'

  return '#6b7280'
}

const MIN_LABEL_WIDTH_PCT = 8

interface TooltipState {
  visible: boolean
  anchorX: number
  triggerTop: number
  triggerBottom: number
  state: string
  startTime: string
  endTime: string
  duration: string
}

const EMPTY_TOOLTIP: TooltipState = {
  visible: false, anchorX: 0, triggerTop: 0, triggerBottom: 0,
  state: '', startTime: '', endTime: '', duration: '',
}

function formatTimestamp(epoch: number): string {
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export const OperatingStateTimeline = memo(function OperatingStateTimeline({ data, hours }: OperatingStateTimelineProps) {
  const [tooltip, setTooltip] = useState<TooltipState>(EMPTY_TOOLTIP)
  const [coords, setCoords] = useState<PopoverCoords | null>(null)

  const setFromEvent = useCallback((seg: { start: number; end: number; state: string }, e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    if (!target) return
    const bar = target.parentElement
    if (!bar) return
    const r = bar.getBoundingClientRect()
    setTooltip({
      visible: true,
      anchorX: e.clientX,
      triggerTop: r.top,
      triggerBottom: r.bottom,
      state: seg.state,
      startTime: formatTimestamp(seg.start),
      endTime: formatTimestamp(seg.end),
      duration: formatDuration(seg.end - seg.start),
    })
    setCoords(null)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setTooltip(prev => ({ ...prev, visible: false }))
    setCoords(null)
  }, [])

  const measureTooltip = useCallback((node: HTMLDivElement | null) => {
    if (!node || !tooltip.visible) return
    setCoords(
      computePopoverCoords(
        { triggerTop: tooltip.triggerTop, triggerBottom: tooltip.triggerBottom, anchorX: tooltip.anchorX },
        { width: node.offsetWidth, height: node.offsetHeight },
      ),
    )
  }, [tooltip])

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
      <div className="relative">
        <div className="h-7 rounded-md overflow-hidden flex">
          {segments.map((seg, i) => {
            const widthPct = ((seg.end - seg.start) / range) * 100
            return (
              <div
                key={i}
                style={{ width: `${widthPct}%`, backgroundColor: getStateColor(seg.state) }}
                className="h-full min-w-[1px] relative"
                onMouseEnter={(e) => setFromEvent(seg, e)}
                onMouseMove={(e) => setFromEvent(seg, e)}
                onMouseLeave={handleMouseLeave}
              >
                {widthPct >= MIN_LABEL_WIDTH_PCT && (
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white leading-none px-1 truncate pointer-events-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
                    {seg.state}
                  </span>
                )}
              </div>
            )
          })}
        </div>
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
      {tooltip.visible && createPortal(
        <div
          ref={measureTooltip}
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords?.top ?? 0,
            left: coords?.left ?? 0,
            visibility: coords ? 'visible' : 'hidden',
          }}
          className="z-[60] pointer-events-none rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-lg px-3 py-2 whitespace-nowrap"
        >
          <div className="text-xs font-semibold text-[var(--text)]">{tooltip.state}</div>
          <div className="text-xs text-[var(--text-muted)]">{tooltip.startTime} – {tooltip.endTime} ({tooltip.duration})</div>
        </div>,
        document.body,
      )}
    </div>
  )
})
