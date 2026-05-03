import { memo } from 'react'
import { Flame, Eye, Clock, EyeOff } from 'lucide-react'
import { cn, formatTemp, statusColor, statusBg } from '../lib/utils'
import type { RoomState, BoostRoom } from '../types/api'
import { EntityValue } from './EntityValue'

const COMFORT_DISPLAY_DECIMALS = 1

const GENERIC_TARGET_TOOLTIP =
  'Active control target. Differs from Comfort when the room is unoccupied, in a scheduled setback, or in away mode.'

interface RoomCardProps {
  name: string
  room: RoomState
  boost?: BoostRoom
  onClick?: () => void
  entityIds?: {
    temp_sensor?: string
    trv_entity?: string
    occupancy_sensor?: string
  }
  engineering?: boolean
  /**
   * Active post-schedule comfort setpoint (`comfort_temp_active` from the
   * pipeline's `CycleMessage.status`) — post-schedule, pre-occupancy,
   * pre-setback. This is the value the pipeline used as the base for
   * room-target derivation, so the tooltip delta matches what the
   * controller just did. Do NOT pass the static configured
   * `comfort_temp` here — during a scheduled override that value is
   * stale and the tooltip delta will be wrong.
   */
  comfortTempActive?: number | null
  /**
   * True when the active heat source is currently commanded to heat the
   * rooms (`live.status.applied_mode === 'heat'`). When false and the
   * room status is 'heating', the badge and amber card tint are
   * suppressed — temperature and target remain visible so the deficit is
   * still observable numerically.
   *
   * Defaults to `true` so callers that have not yet been migrated render
   * the legacy behaviour. Active suppression requires an explicit
   * `hpActive={false}`.
   */
  hpActive?: boolean
}

export const RoomCard = memo(function RoomCard({ name, room, boost, onClick, entityIds, engineering, comfortTempActive, hpActive = true }: RoomCardProps) {
  const displayName = name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  const roundToDisplay = (v: number) => Number(v.toFixed(COMFORT_DISPLAY_DECIMALS))

  let targetTooltip = GENERIC_TARGET_TOOLTIP
  if (comfortTempActive != null && room.target != null) {
    const comfortDisp = roundToDisplay(comfortTempActive)
    const targetDisp = roundToDisplay(room.target)
    if (!Number.isFinite(comfortDisp) || !Number.isFinite(targetDisp)) {
      targetTooltip = GENERIC_TARGET_TOOLTIP
    } else if (comfortDisp === targetDisp) {
      targetTooltip = `Target matches Comfort (${comfortDisp.toFixed(1)}°).`
    } else if (targetDisp < comfortDisp) {
      targetTooltip = `Target ${targetDisp.toFixed(1)}° = Comfort ${comfortDisp.toFixed(1)}° − ${(comfortDisp - targetDisp).toFixed(1)}° setback. Unoccupied rooms, scheduled setbacks, and away mode reduce the target below Comfort to save energy.`
    } else {
      targetTooltip = `Target ${targetDisp.toFixed(1)}° is above Comfort ${comfortDisp.toFixed(1)}° — set by a per-room override or persistent-zone TRV setpoint.`
    }
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-xl border p-4 transition-all hover:shadow-md',
        'bg-[var(--bg-card)]',
        boost
          ? 'border-orange-400/50 bg-orange-500/5'
          : (room.status === 'heating' && !hpActive)
            ? 'border-[var(--border)]'
            : statusBg(room.status)
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <h3 className="font-medium text-sm">{displayName}</h3>
          {boost && <Flame size={14} className="text-orange-500" />}
          {room.temperature_source === 'none_configured' && (
            <span
              className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]"
              title="No temperature sensor configured for this room. QSH operates this room on schedule alone — no measured value, no thermal-parameter learning."
              aria-label="no temperature sensor"
            >
              {/* Inline thermometer-off SVG — lucide-react does not export ThermometerOff in this version. */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 9.5V4a2 2 0 0 1 4 0v3" />
                <path d="M9.5 13a4 4 0 1 0 5.16 6" />
                <path d="m2 2 20 20" />
              </svg>
            </span>
          )}
        </div>
        {boost ? (
          <span className="text-xs font-medium text-orange-500">
            Boost {Math.ceil(boost.remaining_s / 60)}m
          </span>
        ) : (room.status === 'heating' && !hpActive) ? null : (
          <span className={cn('text-xs font-medium capitalize', statusColor(room.status))}>
            {room.status}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1">
        <EntityValue entityId={entityIds?.temp_sensor} engineering={engineering}>
          <span className="text-2xl font-bold">{formatTemp(room.temp)}</span>
        </EntityValue>
        {boost ? (
          <EntityValue entityId={entityIds?.trv_entity} engineering={engineering}>
            <span className="text-sm text-orange-500">
              / {formatTemp(boost.target)}
            </span>
          </EntityValue>
        ) : room.target !== null ? (
          <EntityValue entityId={entityIds?.trv_entity} engineering={engineering}>
            {/* title= intentionally shadows the outer EntityValue title on the target element; the TRV entity id remains discoverable on the "Valve {room.valve}%" span below. */}
            <span className="text-sm text-[var(--text-muted)]" title={targetTooltip}>
              / {formatTemp(room.target)}
            </span>
          </EntityValue>
        ) : null}
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs text-[var(--text-muted)]">
        <EntityValue entityId={entityIds?.trv_entity} engineering={engineering}>
          <span>Valve {room.valve}%</span>
        </EntityValue>
        <span className="flex items-center gap-1 capitalize">
          {room.occupancy_source === 'sensor' && <Eye size={11} className="text-[var(--green)]" />}
          {room.occupancy_source === 'schedule (sensor unavailable)' && <EyeOff size={11} className="text-[var(--amber)]" />}
          {(!room.occupancy_source || room.occupancy_source === 'schedule') && <Clock size={11} />}
          {room.occupancy}
        </span>
      </div>
    </button>
  )
})
