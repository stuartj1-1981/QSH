// Performance: not in 30s WS render path — React.memo not required.
// OccupancyTimeline is only rendered from Away.tsx which fetches its own history
// data and does not subscribe to useLive().
import type { HistoryPoint } from '../hooks/useHistory'

interface OccupancyTimelineProps {
  roomHistory: Record<string, HistoryPoint[]>
  hours: number
}

const OCC_COLORS: Record<string, string> = {
  occupied: '#22c55e',
  unoccupied: '#6b7280',
  away: '#3b82f6',
  unknown: '#d1d5db',
}

export function OccupancyTimeline({ roomHistory, hours }: OccupancyTimelineProps) {
  const rooms = Object.keys(roomHistory)
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
          const segments = buildSegments(points, maxT)

          return (
            <div key={room} className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-muted)] w-24 truncate capitalize">
                {room.replace(/_/g, ' ')}
              </span>
              <div className="flex-1 h-4 rounded overflow-hidden flex">
                {segments.map((seg, i) => {
                  const width = ((seg.end - seg.start) / range) * 100
                  return (
                    <div
                      key={i}
                      style={{
                        width: `${width}%`,
                        backgroundColor: OCC_COLORS[seg.state] ?? '#6b7280',
                      }}
                      title={`${room}: ${seg.state}`}
                      className="h-full min-w-[1px]"
                    />
                  )
                })}
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
    </div>
  )
}

function buildSegments(
  points: HistoryPoint[],
  maxT: number
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
