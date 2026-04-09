import { memo } from 'react'
import { Flame, Eye, Clock, EyeOff } from 'lucide-react'
import { cn, formatTemp, statusColor, statusBg } from '../lib/utils'
import type { RoomState, BoostRoom } from '../types/api'
import { EntityValue } from './EntityValue'

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
}

export const RoomCard = memo(function RoomCard({ name, room, boost, onClick, entityIds, engineering }: RoomCardProps) {
  const displayName = name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-xl border p-4 transition-all hover:shadow-md',
        'bg-[var(--bg-card)]',
        boost ? 'border-orange-400/50 bg-orange-500/5' : statusBg(room.status)
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <h3 className="font-medium text-sm">{displayName}</h3>
          {boost && <Flame size={14} className="text-orange-500" />}
        </div>
        {boost ? (
          <span className="text-xs font-medium text-orange-500">
            Boost {Math.ceil(boost.remaining_s / 60)}m
          </span>
        ) : (
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
            <span className="text-sm text-[var(--text-muted)]">
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
