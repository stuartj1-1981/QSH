import { formatTemp } from '../../lib/utils'
import type { RecoveryRoom } from '../../types/schedule'

interface RecoveryViewProps {
  rooms: Record<string, RecoveryRoom>
}

export function RecoveryView({ rooms }: RecoveryViewProps) {
  const entries = Object.entries(rooms)
  if (entries.length === 0) return null

  const maxMinutes = Math.max(...entries.map(([, r]) => r.estimated_minutes))
  const displayName = (name: string) =>
    name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
      <h2 className="text-lg font-bold mb-1">Welcome back!</h2>
      <p className="text-sm text-[var(--text-muted)] mb-4">
        Recovering {entries.length} room{entries.length !== 1 ? 's' : ''} to comfort temperature.
      </p>

      <div className="space-y-3">
        {entries.map(([room, data]) => {
          return (
            <div key={room}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="font-medium">{displayName(room)}</span>
                <span className="text-xs text-[var(--text-muted)]">
                  {formatTemp(data.current_temp)} &rarr; {formatTemp(data.target_temp)}&ensp;~{data.estimated_minutes}m
                </span>
              </div>
              <div className="h-2 bg-[var(--bg)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all"
                  style={{ width: `${Math.max(5, 100 - (data.delta_c / (data.target_temp - (data.target_temp - data.delta_c))) * 100)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-[var(--text-muted)] mt-4">
        Estimated full comfort: ~{maxMinutes} minutes
      </p>
    </div>
  )
}
