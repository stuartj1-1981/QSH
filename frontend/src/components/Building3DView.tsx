import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { BuildingEngine } from '../lib/buildingEngine'
import type { BuildingLiveData, BuildingViewMode } from '../lib/buildingTypes'
import { useBuildingLayout } from '../hooks/useBuildingLayout'
import { useLive } from '../hooks/useLive'
import type { CycleMessage, RoomState } from '../types/api'
import type { RoomEnvelopeYaml, FaceValue } from '../types/config'
import { normaliseFaceRefs } from '../types/config'
import { cn } from '../lib/utils'

interface Building3DViewProps {
  engineRef: RefObject<BuildingEngine | null>
  dark?: boolean
}

const VIEW_MODES: Array<{ key: BuildingViewMode; label: string }> = [
  { key: '3d', label: '3D' },
  { key: 'exploded', label: 'Exploded' },
  { key: 'thermal', label: 'Thermal' },
  { key: 'envelope', label: 'Envelope' },
]

function cycleToBuildingLive(msg: CycleMessage): BuildingLiveData {
  const rooms: BuildingLiveData['rooms'] = {}
  const src: Record<string, RoomState> = msg.rooms ?? {}
  for (const [name, r] of Object.entries(src)) {
    rooms[name] = {
      temp: r.temp,
      target: r.target,
      valve: r.valve ?? 0,
      status: r.status ?? 'ok',
    }
  }
  const status = msg.status
  const hp = msg.hp
  return {
    rooms,
    system: {
      outdoor_temp: status?.outdoor_temp ?? 0,
      flow_temp: hp?.flow_temp ?? 0,
      return_temp: hp?.return_temp ?? 0,
      delta_t: hp?.delta_t ?? 0,
      power_kw: status?.hp_power_kw ?? 0,
      cop: status?.hp_cop ?? 0,
      mode: status?.applied_mode ?? '',
    },
    cycle_number: msg.cycle_number ?? 0,
  }
}

function describeFace(face: FaceValue | null | undefined): string {
  if (face == null) return '—'
  if (typeof face === 'string') return face
  const refs = normaliseFaceRefs(face)
  if (refs.length === 0) return '—'
  const display = refs.slice(0, 3).map((r) => `→ ${r.room}`)
  if (refs.length > 3) display.push(`+ ${refs.length - 3} more`)
  return display.join(', ')
}

function EnvelopeList({ envelope }: { envelope: RoomEnvelopeYaml }) {
  const faces: Array<{ key: keyof RoomEnvelopeYaml; label: string }> = [
    { key: 'north_wall', label: 'North' },
    { key: 'east_wall', label: 'East' },
    { key: 'south_wall', label: 'South' },
    { key: 'west_wall', label: 'West' },
    { key: 'floor', label: 'Floor' },
    { key: 'ceiling', label: 'Ceiling' },
  ]
  return (
    <ul className="text-xs space-y-1 mt-2">
      {faces.map(({ key, label }) => (
        <li key={key} className="flex justify-between gap-2">
          <span className="text-[var(--text-muted)]">{label}</span>
          <span className="font-mono text-[var(--text)] truncate">
            {describeFace(envelope[key])}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function Building3DView({ engineRef, dark = true }: Building3DViewProps) {
  const { layout, rooms, layoutRooms } = useBuildingLayout()
  const { data: live } = useLive()
  const [viewMode, setViewMode] = useState<BuildingViewMode>('3d')
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null)

  // Push layout whenever solved layout changes.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !layout || !layoutRooms) return
    engine.setLayout(layout, layoutRooms)
  }, [engineRef, layout, layoutRooms])

  // Push live data when cycle message arrives. Engine's setData is idempotent
  // (it diffs material properties internally) — no external diffing needed.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !live) return
    engine.setData(cycleToBuildingLive(live))
  }, [engineRef, live])

  // Sync view mode.
  useEffect(() => {
    engineRef.current?.setView(viewMode)
  }, [engineRef, viewMode])

  // Sync dark mode.
  useEffect(() => {
    engineRef.current?.setDark(dark)
  }, [engineRef, dark])

  // Register room-select callback once.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.onRoomSelect((name) => setSelectedRoom(name))
  }, [engineRef])

  const roomData = selectedRoom && live?.rooms ? live.rooms[selectedRoom] : null
  const roomCfg = selectedRoom && rooms ? rooms[selectedRoom] : null

  // Summary stats when no room selected.
  const allRooms = live?.rooms ?? {}
  const roomNames = Object.keys(allRooms)
  const temps = roomNames
    .map((n) => allRooms[n]?.temp)
    .filter((t): t is number => typeof t === 'number' && isFinite(t))
  const avgTemp = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null
  const belowTarget = roomNames.filter((n) => {
    const r = allRooms[n]
    return r && r.temp != null && r.target != null && r.temp < r.target
  }).length

  return (
    <>
      {/* View mode buttons — bottom-left overlay */}
      <div className="absolute bottom-4 left-4 z-10 flex gap-1
                      bg-[var(--bg-card)] border border-[var(--border)]
                      rounded-lg p-0.5 shadow-lg">
        {VIEW_MODES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setViewMode(key)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              viewMode === key
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Detail / summary panel — right side, desktop only */}
      <div className="hidden lg:flex absolute top-4 right-4 bottom-4 z-10
                      w-[300px] flex-col gap-3 p-4
                      bg-[var(--bg-card)] border border-[var(--border)]
                      rounded-lg shadow-lg overflow-y-auto">
        {selectedRoom && roomCfg ? (
          <>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--text)]">
                {selectedRoom.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </h3>
              <button
                onClick={() => setSelectedRoom(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text)] text-sm"
                aria-label="Close detail panel"
              >
                ×
              </button>
            </div>
            <dl className="text-sm grid grid-cols-2 gap-y-1">
              <dt className="text-[var(--text-muted)]">Temperature</dt>
              <dd className="text-[var(--text)] font-mono text-right">
                {roomData?.temp != null ? `${roomData.temp.toFixed(1)}°` : '—'}
              </dd>
              <dt className="text-[var(--text-muted)]">Target</dt>
              <dd className="text-[var(--text)] font-mono text-right">
                {roomData?.target != null ? `${roomData.target.toFixed(1)}°` : '—'}
              </dd>
              <dt className="text-[var(--text-muted)]">Valve</dt>
              <dd className="text-[var(--text)] font-mono text-right">
                {roomData?.valve != null ? `${roomData.valve.toFixed(0)}%` : '—'}
              </dd>
              <dt className="text-[var(--text-muted)]">Status</dt>
              <dd className="text-[var(--text)] text-right">{roomData?.status ?? '—'}</dd>
            </dl>
            {roomCfg.envelope && (
              <div>
                <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                  Envelope
                </h4>
                <EnvelopeList envelope={roomCfg.envelope} />
              </div>
            )}
          </>
        ) : (
          <>
            <h3 className="text-base font-semibold text-[var(--text)]">Building</h3>
            <dl className="text-sm grid grid-cols-2 gap-y-1">
              <dt className="text-[var(--text-muted)]">Rooms</dt>
              <dd className="text-[var(--text)] font-mono text-right">{roomNames.length}</dd>
              <dt className="text-[var(--text-muted)]">Avg temp</dt>
              <dd className="text-[var(--text)] font-mono text-right">
                {avgTemp != null ? `${avgTemp.toFixed(1)}°` : '—'}
              </dd>
              <dt className="text-[var(--text-muted)]">Below target</dt>
              <dd className="text-[var(--text)] font-mono text-right">{belowTarget}</dd>
            </dl>
            <p className="text-xs text-[var(--text-muted)] mt-auto">
              Click a room to inspect
            </p>
          </>
        )}
      </div>
    </>
  )
}
