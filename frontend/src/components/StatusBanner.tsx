import { memo } from 'react'
import { Zap, Wind, AlertTriangle, Flame, EyeOff } from 'lucide-react'
import { cn } from '../lib/utils'
import type { RoomState, DriverStatus } from '../types/api'
import { EntityValue } from './EntityValue'

const PAUSE_STRATEGIES = [
  'hw active', 'hw pre-charge', 'hw recovery',
  'defrost', 'oil recovery', 'short cycle pause',
]

interface StatusBannerProps {
  operatingState: string
  controlEnabled: boolean
  appliedFlow: number
  appliedMode: string
  outdoorTemp: number
  hpPowerKw: number
  hpCop: number
  optimalMode?: string
  boostActive?: boolean
  boostRoomCount?: number
  rooms?: Record<string, RoomState>
  entityMap?: {
    outdoor_temp?: string
    hp_power?: string
    hp_cop?: string
  }
  engineering?: boolean
  driverStatus?: DriverStatus
}

export const StatusBanner = memo(function StatusBanner({
  operatingState,
  controlEnabled,
  appliedFlow,
  appliedMode,
  outdoorTemp,
  hpPowerKw,
  hpCop,
  optimalMode,
  boostActive,
  boostRoomCount,
  rooms,
  entityMap,
  engineering,
  driverStatus,
}: StatusBannerProps) {
  const isPaused = PAUSE_STRATEGIES.some(s => operatingState.toLowerCase().includes(s))
  const stateColor = getStateColor(operatingState)

  // Derive rooms with unavailable occupancy sensors from live WebSocket data
  const fallbackRooms = rooms
    ? Object.entries(rooms).filter(([, r]) => r.occupancy_source?.includes('unavailable'))
    : []

  return (
    <>
      {/* Driver error banner — degraded mode (MQTT connection failure etc.) */}
      {driverStatus?.status === 'error' && (
        <div className="rounded-xl border p-4 mb-2 bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-300 flex items-start gap-3 text-sm">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">MQTT broker connection failed</div>
            <div className="mt-1 text-xs opacity-80">{driverStatus.error}</div>
            <div className="mt-2 text-xs">
              Check Settings &rarr; Heat Source to verify broker address, port, and credentials.
            </div>
          </div>
        </div>
      )}

      {/* Pause warning strip */}
      {isPaused && (
        <div className="rounded-xl border p-3 mb-2 bg-amber-500/15 border-amber-500/30 text-amber-700 flex items-center gap-2 text-sm font-medium">
          <AlertTriangle size={16} />
          Pipeline Paused: {operatingState}
        </div>
      )}

      <div className={cn(
        'rounded-xl border p-4 mb-4',
        'bg-[var(--bg-card)] border-[var(--border)]'
      )}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* Operating state */}
          <div className="flex items-center gap-3">
            <div className={cn('w-3 h-3 rounded-full', stateColor)} />
            <div>
              <div className="font-semibold text-lg">{operatingState}</div>
              <div className="text-xs text-[var(--text-muted)]">
                {controlEnabled ? 'Active control' : 'Shadow mode'}
                {appliedMode !== 'off' && ` · ${appliedFlow.toFixed(0)}°C flow`}
              </div>
              {/* Shadow mode recommendation */}
              {!controlEnabled && optimalMode && (
                <div className="text-xs text-[var(--blue)] mt-0.5">
                  QSH recommends: {optimalMode}
                </div>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <div className="flex items-center gap-3 sm:gap-6 text-xs sm:text-sm">
            {boostActive && (
              <div className="flex items-center gap-1.5 text-orange-500">
                <Flame size={16} />
                <span className="font-medium">Boost ({boostRoomCount})</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Wind size={16} className="text-[var(--blue)]" />
              <EntityValue entityId={entityMap?.outdoor_temp} engineering={engineering}>
                <span>{outdoorTemp.toFixed(1)}°C</span>
              </EntityValue>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap size={16} className="text-[var(--amber)]" />
              <EntityValue entityId={entityMap?.hp_power} engineering={engineering}>
                <span>{hpPowerKw.toFixed(1)}kW</span>
              </EntityValue>
              {hpCop > 0 && (
                <EntityValue entityId={entityMap?.hp_cop} engineering={engineering}>
                  <span className="text-[var(--text-muted)]">COP {hpCop.toFixed(1)}</span>
                </EntityValue>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sensor fallback warning */}
      {fallbackRooms.length > 0 && (
        <div className="rounded-xl border p-3 mb-4 bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300 flex items-center gap-2 text-sm">
          <EyeOff size={16} className="shrink-0" />
          <span>
            Occupancy sensor unavailable for{' '}
            <strong>{fallbackRooms.map(([name]) => name.replace(/_/g, ' ')).join(', ')}</strong>
            {' '}&mdash; using schedule fallback
          </span>
        </div>
      )}
    </>
  )
})

function getStateColor(state: string): string {
  if (PAUSE_STRATEGIES.some(s => state.toLowerCase().includes(s))) return 'bg-red-500'
  const s = state.toLowerCase()
  if (s.includes('winter')) return 'bg-[var(--blue)]'
  if (s.includes('heat')) return 'bg-[var(--accent)]'
  if (s.includes('idle') || s.includes('off')) return 'bg-[var(--green)]'
  if (s.includes('away')) return 'bg-[var(--blue)]'
  if (s.includes('shoulder') || s.includes('summer')) return 'bg-[var(--amber)]'
  return 'bg-[var(--text-muted)]'
}
