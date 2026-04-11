import { formatTemp } from '../../lib/utils'
import type { ZoneAwayState } from '../../types/schedule'

interface SetbackCardProps {
  zones: Record<string, ZoneAwayState>
  days: number
}

export function SetbackCard({ zones, days }: SetbackCardProps) {
  // Compute aggregate stats from all active zones
  const activeZones = Object.entries(zones).filter(([, z]) => z.active && !z.is_persistent)

  if (activeZones.length === 0) return null

  const avgDepth =
    activeZones.reduce((sum, [, z]) => sum + z.computed_depth_c, 0) / activeZones.length

  // Representative before/after
  const firstZone = activeZones[0][1]
  const beforeTarget = firstZone.target_temp
  const afterTarget = beforeTarget ? beforeTarget - avgDepth : null

  // Rough recovery estimate
  const estRecoveryMin = avgDepth > 0 ? Math.round(avgDepth / 0.5 * 15) : 0

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
      <h3 className="text-sm font-semibold mb-3">Setback Summary</h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-[var(--bg)] rounded-lg px-3 py-2">
          <div className="text-xs text-[var(--text-muted)]">Computed setback</div>
          <div className="font-medium">{avgDepth.toFixed(1)}&deg;C</div>
        </div>
        <div className="bg-[var(--bg)] rounded-lg px-3 py-2">
          <div className="text-xs text-[var(--text-muted)]">Targets</div>
          <div className="font-medium">
            {formatTemp(beforeTarget)} &rarr; {formatTemp(afterTarget)}
          </div>
        </div>
        <div className="bg-[var(--bg)] rounded-lg px-3 py-2">
          <div className="text-xs text-[var(--text-muted)]">Duration</div>
          <div className="font-medium">{days > 0 ? `${days} day${days !== 1 ? 's' : ''}` : 'Indefinite'}</div>
        </div>
        <div className="bg-[var(--bg)] rounded-lg px-3 py-2">
          <div className="text-xs text-[var(--text-muted)]">Est. recovery</div>
          <div className="font-medium">{estRecoveryMin > 0 ? `~${estRecoveryMin} min` : '-'}</div>
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)] mt-3">
        Calculated from absence duration, building thermal properties, and forecast COP.
      </p>
    </div>
  )
}
