import { useState } from 'react'
import { X, Calendar, Plane, Flame, Eye, EyeOff } from 'lucide-react'
import { formatTemp, statusColor, cn } from '../lib/utils'
import type { RoomState, SysidRoom, BoostRoom } from '../types/api'
import { useRoomHistory } from '../hooks/useHistory'
import { TrendChart } from './TrendChart'
import { apiUrl } from '../lib/api'
import { EntityValue } from './EntityValue'

interface RoomDetailProps {
  name: string
  room: RoomState
  sysid?: SysidRoom
  boost?: BoostRoom
  engineering: boolean
  onClose: () => void
  entityIds?: {
    temp_sensor?: string
    trv_entity?: string
    occupancy_sensor?: string
  }
  /** See RoomCard.hpActive — same semantics. Defaults to `true`. */
  hpActive?: boolean
}

export function RoomDetail({ name, room, sysid, boost, engineering, onClose, entityIds, hpActive = true }: RoomDetailProps) {
  const { data: roomHistory } = useRoomHistory(['temp', 'valve'], 24)
  const thisRoomHistory = roomHistory[name] ?? []

  // Transform room history into chart-friendly format
  const tempData = thisRoomHistory.map(p => ({ t: p.t, temp: p.temp }))
  const valveData = thisRoomHistory.map(p => ({ t: p.t, valve: p.valve }))

  const displayName = name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 pb-0 mb-4 shrink-0">
          <h2 className="text-xl font-bold">{displayName}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--bg)]">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto px-4 sm:px-6 pb-2 min-h-0">

        {/* Temperature */}
        <div className="text-center mb-6">
          <EntityValue entityId={entityIds?.temp_sensor} engineering={engineering}>
            <div className="text-3xl sm:text-5xl font-bold mb-1">{formatTemp(room.temp)}</div>
          </EntityValue>
          <div className="text-lg text-[var(--text-muted)]">
            Target: <EntityValue entityId={entityIds?.trv_entity} engineering={engineering}>{formatTemp(room.target)}</EntityValue>
          </div>
          {!(room.status === 'heating' && !hpActive) && (
            <div className={cn('text-sm font-medium capitalize mt-1', statusColor(room.status))}>
              {room.status}
            </div>
          )}
        </div>

        {/* Occupancy badge */}
        <div className="flex items-center justify-center gap-2 mb-4">
          {(() => {
            const OccIcon = room.occupancy_source === 'sensor' ? Eye
              : room.occupancy_source?.includes('unavailable') ? EyeOff
              : Calendar
            return (
              <>
                {room.occupancy === 'occupied' && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/10 text-green-600 text-xs font-medium">
                    <OccIcon size={12} /> Occupied
                  </span>
                )}
                {room.occupancy === 'unoccupied' && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-500/10 text-gray-500 text-xs font-medium">
                    <OccIcon size={12} /> Unoccupied
                  </span>
                )}
              </>
            )
          })()}
          {room.occupancy === 'away' && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-500/10 text-blue-500 text-xs font-medium">
              <Plane size={12} /> Away
            </span>
          )}
        </div>

        {/* Sensor unavailable explanation */}
        {room.occupancy_source?.includes('unavailable') && (
          <p className="text-xs text-amber-600 dark:text-amber-400 text-center mb-4 px-4">
            Occupancy sensor is not responding. Using your saved schedule to determine if this room is occupied.
          </p>
        )}

        {/* Boost controls */}
        <BoostSection name={name} room={room} boost={boost} />

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <DetailItem label="Valve" value={`${room.valve}%`} entityId={entityIds?.trv_entity} engineering={engineering} />
          <DetailItem label="Occupancy" value={room.occupancy} />
          {room.occupancy_source && (
            <DetailItem label="Occ. Source" value={room.occupancy_source} />
          )}
          <DetailItem label="Area" value={`${room.area_m2}m²`} />
          <DetailItem label="Ceiling" value={`${room.ceiling_m}m`} />
        </div>

        {/* Temperature history */}
        {tempData.length > 0 && (
          <div className="mt-4 pt-4 border-t border-[var(--border)]">
            <TrendChart
              title="Temperature (24h)"
              data={tempData}
              lines={[{ key: 'temp', label: 'Temperature', color: 'var(--accent)' }]}
              yUnit="°C"
            />
          </div>
        )}

        {/* Valve history */}
        {valveData.length > 0 && (
          <TrendChart
            title="Valve Position (24h)"
            data={valveData}
            lines={[{ key: 'valve', label: 'Valve', color: 'var(--blue)' }]}
            yUnit="%"
          />
        )}

        {/* Engineering section */}
        {engineering && sysid && (
          <div className="mt-4 pt-4 border-t border-[var(--border)]">
            <h3 className="text-sm font-semibold mb-2 text-[var(--accent)]">System ID</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <DetailItem label="U (kW/°C)" value={sysid.u_kw_per_c.toFixed(4)} />
              <DetailItem label="C (kWh/°C)" value={sysid.c_kwh_per_c.toFixed(4)} />
              <DetailItem label="U obs" value={String(sysid.u_observations)} />
              <DetailItem label="C obs" value={String(sysid.c_observations)} />
              <DetailItem label="C source" value={sysid.c_source} />
              <DetailItem label="Confidence" value={sysid.confidence} />
              <DetailItem label="Solar gain" value={sysid.solar_gain.toFixed(3)} />
              <DetailItem label="PC fits" value={String(sysid.pc_fits)} />
            </div>
          </div>
        )}
        </div>

        {/* Close button */}
        <div className="p-4 sm:p-6 pt-4 shrink-0 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="w-full py-2 rounded-lg bg-[var(--bg)] hover:bg-[var(--border)] text-sm font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function BoostSection({ name, room, boost }: { name: string; room: RoomState; boost?: BoostRoom }) {
  const currentTarget = room.target ?? 21
  const [boostTarget, setBoostTarget] = useState(Math.min(currentTarget + 2, 30))
  const [boostDuration, setBoostDuration] = useState(30)
  const [loading, setLoading] = useState(false)

  const startBoost = async () => {
    setLoading(true)
    try {
      await fetch(apiUrl(`api/control/rooms/${name}/boost`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: boostTarget, duration_m: boostDuration }),
      })
    } finally {
      setLoading(false)
    }
  }

  const cancelBoost = async () => {
    setLoading(true)
    try {
      await fetch(apiUrl(`api/control/rooms/${name}/boost`), { method: 'DELETE' })
    } finally {
      setLoading(false)
    }
  }

  if (boost) {
    return (
      <div className="mb-4 p-3 rounded-xl border border-orange-400/30 bg-orange-500/10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Flame size={16} className="text-orange-500" />
            <span className="font-semibold text-sm text-orange-600">Boost Active</span>
          </div>
          <span className="text-xs text-orange-500 font-medium">
            {Math.ceil(boost.remaining_s / 60)}m remaining
          </span>
        </div>
        <div className="text-sm mb-2">
          Target: {boost.target.toFixed(1)}°C (was {boost.original_target.toFixed(1)}°C)
        </div>
        <button
          onClick={cancelBoost}
          disabled={loading}
          className="w-full py-1.5 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 text-orange-600 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loading ? 'Cancelling...' : 'Cancel Boost'}
        </button>
      </div>
    )
  }

  return (
    <div className="mb-4 p-3 rounded-xl border border-[var(--border)] bg-[var(--bg)]">
      <div className="flex items-center gap-1.5 mb-3">
        <Flame size={14} className="text-[var(--text-muted)]" />
        <span className="text-sm font-medium">Boost</span>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-[var(--text-muted)] block mb-1">Target</label>
          <input
            type="range"
            min={currentTarget + 0.5}
            max={30}
            step={0.5}
            value={boostTarget}
            onChange={(e) => setBoostTarget(Number(e.target.value))}
            className="w-full"
          />
          <div className="text-center text-sm font-medium">{boostTarget.toFixed(1)}°C</div>
        </div>
        <div>
          <label className="text-xs text-[var(--text-muted)] block mb-1">Duration</label>
          <div className="flex gap-1">
            {[30, 45, 60].map((d) => (
              <button
                key={d}
                onClick={() => setBoostDuration(d)}
                className={cn(
                  'flex-1 py-1 rounded text-xs font-medium transition-colors',
                  boostDuration === d
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-card)] hover:bg-[var(--border)]'
                )}
              >
                {d}m
              </button>
            ))}
          </div>
        </div>
      </div>
      <button
        onClick={startBoost}
        disabled={loading || boostTarget <= currentTarget}
        className="w-full py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
      >
        {loading ? 'Starting...' : 'Start Boost'}
      </button>
    </div>
  )
}

function DetailItem({ label, value, entityId, engineering }: { label: string; value: string; entityId?: string; engineering?: boolean }) {
  return (
    <div className="bg-[var(--bg)] rounded-lg px-3 py-2">
      <div className="text-[var(--text-muted)] text-xs">{label}</div>
      <EntityValue entityId={entityId} engineering={engineering}>
        <div className="font-medium capitalize">{value}</div>
      </EntityValue>
    </div>
  )
}
