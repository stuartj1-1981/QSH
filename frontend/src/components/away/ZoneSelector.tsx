import { cn } from '../../lib/utils'
import type { ZoneAwayState } from '../../types/schedule'

interface ZoneSelectorProps {
  zones: Record<string, ZoneAwayState>
  onToggleZone: (room: string, active: boolean, days: number) => void
}

export function ZoneSelector({ zones, onToggleZone }: ZoneSelectorProps) {
  const displayName = (name: string) =>
    name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5">
      <h3 className="text-sm font-semibold mb-3">Per-Zone Controls</h3>
      <div className="space-y-2">
        <div className="hidden sm:grid grid-cols-4 gap-2 text-xs text-[var(--text-muted)] font-medium px-1">
          <span>Room</span>
          <span>Away</span>
          <span>Days</span>
          <span>Depth</span>
        </div>
        {Object.entries(zones).map(([room, zone]) => (
          <div
            key={room}
            className={cn(
              'grid grid-cols-2 sm:grid-cols-4 gap-x-2 gap-y-1 sm:gap-2 items-center px-1 py-2 rounded-lg text-sm',
              zone.is_persistent ? 'opacity-50' : ''
            )}
          >
            <span className="font-medium truncate">
              {displayName(room)}
              {zone.is_persistent && <span className="text-xs text-[var(--text-muted)]"> *</span>}
            </span>
            <div>
              <button
                onClick={() => onToggleZone(room, !zone.active, zone.days)}
                disabled={zone.is_persistent}
                className={cn(
                  'w-10 h-5 rounded-full relative transition-colors',
                  zone.active ? 'bg-[var(--accent)]' : 'bg-gray-400',
                  zone.is_persistent ? 'cursor-not-allowed' : 'cursor-pointer'
                )}
              >
                <div
                  className={cn(
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                    zone.active ? 'translate-x-5.5' : 'translate-x-0.5'
                  )}
                />
              </button>
            </div>
            <div>
              {zone.active && !zone.is_persistent ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      // From ∞ (0), go to 1. From 1, wrap to ∞ (0). Otherwise decrement.
                      const next = zone.days === 0 ? 1 : zone.days <= 1 ? 0 : zone.days - 1
                      onToggleZone(room, true, next)
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] text-sm hover:bg-[var(--bg-card)] leading-none"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-xs font-medium text-[var(--text)]">
                    {zone.days === 0 ? '∞' : zone.days}
                  </span>
                  <button
                    onClick={() => {
                      // From ∞ (0), go to 1. Otherwise increment.
                      const next = zone.days === 0 ? 1 : zone.days + 1
                      onToggleZone(room, true, next)
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] text-sm hover:bg-[var(--bg-card)] leading-none"
                  >
                    +
                  </button>
                </div>
              ) : (
                <span className="text-xs text-[var(--text-muted)]">−</span>
              )}
            </div>
            <span className="text-xs text-[var(--text-muted)]">
              {zone.computed_depth_c > 0 ? `${zone.computed_depth_c.toFixed(1)}\u00B0C` : '-'}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--text-muted)] mt-3">* = persistent zone (always at comfort)</p>
    </div>
  )
}
