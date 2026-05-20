// Performance: not in 30s WS render path — React.memo not required.
// OccupancyTimeline is only rendered from Away.tsx which fetches its own history
// data and does not subscribe to useLive().
import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { HistoryPoint } from '../hooks/useHistory'
import { formatTimeRange } from '../lib/utils'
import { computePopoverCoords, type PopoverCoords } from '../lib/popover'

interface OccupancyTimelineProps {
  roomHistory: Record<string, HistoryPoint[]>
  hours: number
}

interface TooltipState {
  room: string
  state: string
  range: string
  anchorX: number      // viewport-space X for popover centring
  triggerTop: number   // viewport-space top of the row band
  triggerBottom: number // viewport-space bottom of the row band
}

const OCC_COLORS: Record<string, string> = {
  occupied: '#22c55e',
  unoccupied: '#6b7280',
  away: '#3b82f6',
  unknown: '#d1d5db',
}

const MIN_SEGMENT_SECONDS = 60

/**
 * Capture the viewport-space anchor for the tooltip in a single
 * getBoundingClientRect read. All synthetic-event reads happen synchronously
 * inside the mouse handler so React never re-examines the event after the
 * handler returns (INSTRUCTION-103 invariant).
 */
function captureAnchor(e: React.MouseEvent<HTMLDivElement>): { anchorX: number; triggerTop: number; triggerBottom: number } | null {
  const target = e.currentTarget
  if (!target) return null
  const row = target.parentElement
  if (!row) return null
  const r = row.getBoundingClientRect()
  return { anchorX: e.clientX, triggerTop: r.top, triggerBottom: r.bottom }
}

export function OccupancyTimeline({ roomHistory, hours }: OccupancyTimelineProps) {
  const rooms = Object.keys(roomHistory)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [coords, setCoords] = useState<PopoverCoords | null>(null)

  const measureTooltip = useCallback((node: HTMLDivElement | null) => {
    if (!node || !tooltip) return
    setCoords(
      computePopoverCoords(
        { triggerTop: tooltip.triggerTop, triggerBottom: tooltip.triggerBottom, anchorX: tooltip.anchorX },
        { width: node.offsetWidth, height: node.offsetHeight },
      ),
    )
  }, [tooltip])

  if (rooms.length === 0) return null

  // Find global time range
  let minT = Infinity
  let maxT = -Infinity
  for (const points of Object.values(roomHistory)) {
    for (const p of points) {
      const t = p.t as number
      if (t < minT) minT = t
      if (t > maxT) maxT = t
    }
  }
  const range = maxT - minT || 1

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <h3 className="text-sm font-semibold mb-3">Occupancy Timeline ({hours}h)</h3>
      <div className="space-y-2">
        {rooms.map(room => {
          const points = roomHistory[room]
          const segments = mergeTinySegments(buildSegments(points, maxT))
          const displayName = room.replace(/_/g, ' ')

          return (
            <div key={room} className="flex items-center gap-3 relative">
              <span className="text-xs text-[var(--text-muted)] w-24 truncate capitalize">
                {displayName}
              </span>
              {/* Strip wrapper: positions the strip itself. Tooltip is portaled to
                  document.body so this no longer needs to be a positioning context
                  for the tooltip. */}
              <div className="flex-1 relative">
                {/* Segments container: overflow-hidden so the rounded corners clip the
                    coloured fills. */}
                <div className="h-6 rounded overflow-hidden flex">
                  {segments.map((seg, i) => {
                    const width = ((seg.end - seg.start) / range) * 100
                    const range_str = formatTimeRange(seg.start, seg.end)
                    return (
                      <div
                        key={i}
                        style={{
                          width: `${width}%`,
                          backgroundColor: OCC_COLORS[seg.state] ?? '#6b7280',
                        }}
                        // Single-space separator (no \n) — Safari collapses \n in
                        // title attributes, and this value is now consumed only by
                        // screen readers. The visible tooltip is driven by React state.
                        title={`${displayName} — ${seg.state} ${range_str}`}
                        className="h-full min-w-[1px] cursor-default"
                        onMouseEnter={(e) => {
                          // Capture anchor synchronously — e.currentTarget is valid here because
                          // we are inside the event handler. Passing a plain object (not an
                          // updater) means React never re-reads the event after this function
                          // returns. This is the crash fix from INSTRUCTION-103.
                          const anchor = captureAnchor(e)
                          if (!anchor) return
                          setTooltip({
                            room: displayName,
                            state: seg.state,
                            range: range_str,
                            ...anchor,
                          })
                          setCoords(null)
                        }}
                        onMouseLeave={() => {
                          setTooltip(null)
                          setCoords(null)
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-4 mt-3">
        {Object.entries(OCC_COLORS).map(([state, color]) => (
          <div key={state} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            {state}
          </div>
        ))}
      </div>
      {tooltip && createPortal(
        <div
          ref={measureTooltip}
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords?.top ?? 0,
            left: coords?.left ?? 0,
            visibility: coords ? 'visible' : 'hidden',
          }}
          className="z-[60] pointer-events-none px-2 py-1 rounded shadow-lg text-xs whitespace-nowrap
                     bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text)]"
        >
          <div className="font-medium capitalize">{tooltip.room}</div>
          <div className="text-[var(--text-muted)]">
            {tooltip.state} · {tooltip.range}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function buildSegments(
  points: HistoryPoint[],
  maxT: number,
): { start: number; end: number; state: string }[] {
  const segments: { start: number; end: number; state: string }[] = []
  for (let i = 0; i < points.length; i++) {
    const state = String(points[i].occupancy ?? 'unknown')
    const t = points[i].t as number
    const nextT = i < points.length - 1 ? (points[i + 1].t as number) : maxT

    if (segments.length > 0 && segments[segments.length - 1].state === state) {
      segments[segments.length - 1].end = nextT
    } else {
      segments.push({ start: t, end: nextT, state })
    }
  }
  return segments
}

function mergeTinySegments(
  segments: { start: number; end: number; state: string }[],
): { start: number; end: number; state: string }[] {
  if (segments.length <= 1) return segments

  // Pass 1: forward-absorb a tiny leading segment into the next segment.
  // Without this, a < MIN_SEGMENT_SECONDS first segment would pass the
  // `out.length > 0` guard in pass 2 and be preserved as-is, producing
  // a 1 px segment at the left edge of the strip.
  const pre = segments.map(s => ({ ...s }))
  while (pre.length > 1 && pre[0].end - pre[0].start < MIN_SEGMENT_SECONDS) {
    // absorb pre[0] into pre[1]: take pre[1]'s state, extend start back
    pre[1].start = pre[0].start
    pre.shift()
  }

  // Pass 2: backward-absorb any remaining tiny interior segments.
  const out: { start: number; end: number; state: string }[] = []
  for (const seg of pre) {
    const dur = seg.end - seg.start
    if (dur < MIN_SEGMENT_SECONDS && out.length > 0) {
      out[out.length - 1].end = seg.end
    } else {
      out.push({ ...seg })
    }
  }

  // Pass 3: merge consecutive same-state runs that may have resulted.
  const merged: { start: number; end: number; state: string }[] = []
  for (const seg of out) {
    if (merged.length > 0 && merged[merged.length - 1].state === seg.state) {
      merged[merged.length - 1].end = seg.end
    } else {
      merged.push({ ...seg })
    }
  }
  return merged
}
