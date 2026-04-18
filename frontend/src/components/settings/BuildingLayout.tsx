import { useMemo, useState } from 'react'
import {
  Save,
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import { useRawConfig } from '../../hooks/useConfig'
import {
  useEnvelope,
  WALL_FACE_KEYS,
  type FaceKey,
} from '../../hooks/useEnvelope'
import type {
  FaceValue,
  RoomBoundaryYaml,
  RoomConfigYaml,
} from '../../types/config'
import { cn } from '../../lib/utils'

const FLOOR_OPTIONS: Array<{ value: number; label: string }> = [
  { value: -1, label: 'Basement' },
  { value: 0, label: 'Ground' },
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
]

const FLOOR_SHORT: Record<number, string> = {
  [-1]: 'B',
  0: 'G',
  1: '1',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
}

/** Relative-position hint for a wall face, given the room's facing direction.
 *  Returns null for non-cardinal facings (NE/SE/SW/NW) or interior. */
function wallRelativeHint(face: FaceKey, facing: string): string | null {
  if (!WALL_FACE_KEYS.includes(face)) return null
  const f = facing.toUpperCase()
  if (f !== 'N' && f !== 'E' && f !== 'S' && f !== 'W') return null
  const frontMap: Record<string, FaceKey> = { N: 'north_wall', E: 'east_wall', S: 'south_wall', W: 'west_wall' }
  const backMap: Record<string, FaceKey> = { N: 'south_wall', E: 'west_wall', S: 'north_wall', W: 'east_wall' }
  const leftMap: Record<string, FaceKey> = { N: 'west_wall', E: 'north_wall', S: 'east_wall', W: 'south_wall' }
  const rightMap: Record<string, FaceKey> = { N: 'east_wall', E: 'south_wall', S: 'west_wall', W: 'north_wall' }
  if (frontMap[f] === face) return 'front'
  if (backMap[f] === face) return 'back'
  if (leftMap[f] === face) return 'left'
  if (rightMap[f] === face) return 'right'
  return null
}

/** Build the label for a face given the room's facing. */
function faceLabel(face: FaceKey, facing: string): string {
  if (face === 'floor') return 'Floor'
  if (face === 'ceiling') return 'Ceiling'
  const isInterior = (facing || 'interior').toLowerCase() === 'interior'
  if (isInterior) {
    const idx = WALL_FACE_KEYS.indexOf(face) + 1
    return `Wall ${idx}`
  }
  const compass =
    face === 'north_wall'
      ? 'North'
      : face === 'south_wall'
        ? 'South'
        : face === 'east_wall'
          ? 'East'
          : 'West'
  const hint = wallRelativeHint(face, facing)
  return hint ? `${compass} wall (${hint})` : `${compass} wall`
}

type LiteralOption = 'external' | 'unheated' | 'ground' | 'roof'

function literalOptionsForFace(face: FaceKey): LiteralOption[] {
  if (face === 'floor') return ['ground', 'unheated']
  if (face === 'ceiling') return ['roof', 'unheated']
  return ['external', 'unheated']
}

function faceValueToSelectValue(v: FaceValue | null | undefined): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return `literal:${v}`
  if (Array.isArray(v)) return v.length > 0 ? `room:${v[0].room}` : ''
  return `room:${v.room}`
}

function selectValueToFace(v: string): FaceValue | null {
  if (!v) return null
  if (v.startsWith('literal:')) return v.slice('literal:'.length) as FaceValue
  if (v.startsWith('room:')) return { room: v.slice('room:'.length) } as RoomBoundaryYaml
  return null
}

/** Check if a face value contains any room references. */
function hasRoomRefs(v: FaceValue | null | undefined): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return false
  if (Array.isArray(v)) return v.length > 0
  return 'room' in v
}

/** Extract all room references from a face value. */
function normaliseRefs(v: FaceValue | null | undefined): RoomBoundaryYaml[] {
  if (v === null || v === undefined) return []
  if (typeof v === 'string') return []
  if (Array.isArray(v)) return v
  return [v]
}

/** Count external-literal faces for a room summary. */
function externalFaces(env: import('../../types/config').RoomEnvelopeYaml): {
  walls: number
  hasGround: boolean
  hasRoof: boolean
} {
  let walls = 0
  let hasGround = false
  let hasRoof = false
  for (const w of WALL_FACE_KEYS) {
    if (env[w] === 'external') walls += 1
  }
  if (env.floor === 'ground') hasGround = true
  if (env.ceiling === 'roof') hasRoof = true
  return { walls, hasGround, hasRoof }
}

function coupledTargets(env: import('../../types/config').RoomEnvelopeYaml): string[] {
  const out: string[] = []
  for (const k of Object.keys(env) as FaceKey[]) {
    const v = env[k]
    const refs = normaliseRefs(v)
    for (const ref of refs) {
      const tp = ref.type ?? 'wall'
      const typeDisplay = tp === 'floor_ceiling' ? 'f/c' : tp.replace('_', '/')
      out.push(`${ref.room} (${typeDisplay})`)
    }
  }
  return out
}

interface BuildingLayoutProps {
  onRefetch?: () => void
}

export function BuildingLayout({ onRefetch }: BuildingLayoutProps) {
  const { data, loading, refetch } = useRawConfig()
  const handleSaved = () => {
    refetch()
    onRefetch?.()
  }
  const rawRooms = data?.rooms
  const env = useEnvelope({ rooms: rawRooms, onSaved: handleSaved })

  const [expanded, setExpanded] = useState<string | null>(null)
  const [pendingSaveError, setPendingSaveError] = useState<string | null>(null)

  const facingByRoom: Record<string, string> = useMemo(() => {
    const out: Record<string, string> = {}
    if (rawRooms) {
      for (const [n, cfg] of Object.entries(rawRooms)) {
        out[n] = (cfg as RoomConfigYaml).facing ?? 'interior'
      }
    }
    return out
  }, [rawRooms])

  const hasAnyFloor = useMemo(
    () => Object.values(env.rooms).some((r) => r.floor !== null),
    [env.rooms],
  )

  const roomsByFloor = useMemo(() => {
    const groups = new Map<number | 'unassigned', string[]>()
    for (const name of env.roomNames) {
      const f = env.rooms[name].floor
      const key = f === null ? 'unassigned' : f
      const arr = groups.get(key) ?? []
      arr.push(name)
      groups.set(key, arr)
    }
    return groups
  }, [env.rooms, env.roomNames])

  const orderedFloorKeys = useMemo(() => {
    const keys: Array<number | 'unassigned'> = []
    const numeric = Array.from(roomsByFloor.keys()).filter(
      (k): k is number => typeof k === 'number',
    )
    numeric.sort((a, b) => b - a) // top floor first
    keys.push(...numeric)
    if (roomsByFloor.has('unassigned')) keys.push('unassigned')
    return keys
  }, [roomsByFloor])

  /** Detect cases where the UI should prompt the user to confirm an
   *  ambiguous wall-symmetry assignment (same-floor compass reciprocal was
   *  occupied by a different room or interior-room auto-pick). */
  const ambiguousPrompts = useMemo(() => {
    const out: Array<{ target: string; source: string; sourceFace: FaceKey; currentTargetFace: FaceKey }> = []
    for (const [room, rs] of Object.entries(env.rooms)) {
      for (const face of WALL_FACE_KEYS) {
        const v = rs.envelope[face]
        if (!v || typeof v !== 'object' || !('room' in v)) continue
        // Only flag auto-populated wall assignments on interior rooms (abstract walls).
        if (!env.isAutoSet(room, face)) continue
        const peer = v.room
        const facingMe = (facingByRoom[room] || 'interior').toLowerCase() === 'interior'
        if (facingMe) {
          out.push({ target: room, source: peer, sourceFace: face, currentTargetFace: face })
        }
      }
    }
    return out
  }, [env, facingByRoom])

  const doSave = async () => {
    setPendingSaveError(null)
    const result = await env.save()
    if (!result) setPendingSaveError(env.error)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
      </div>
    )
  }

  if (!data) {
    return (
      <p className="text-sm text-[var(--text-muted)]">Unable to load configuration.</p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[var(--text)]">Building Layout</h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Assign rooms to floors, then declare the 6 faces of each room&rsquo;s envelope.
          </p>
        </div>
        <button
          onClick={doSave}
          disabled={!env.dirty || env.saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {env.saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          Save Building Layout
        </button>
      </div>

      {(pendingSaveError || env.error) && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/5 text-sm">
          <AlertTriangle size={16} className="text-[var(--red)] shrink-0 mt-0.5" />
          <span className="text-[var(--red)]">{pendingSaveError || env.error}</span>
        </div>
      )}

      {env.warnings.length > 0 && (
        <div className="p-3 rounded-lg border border-[var(--amber,#d97706)]/40 bg-[var(--amber,#d97706)]/5 text-sm space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle size={14} />
            Server warnings
          </div>
          <ul className="list-disc list-inside text-xs text-[var(--text-muted)]">
            {env.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Floor Assignment Panel */}
      <FloorAssignmentPanel
        roomsByFloor={roomsByFloor}
        orderedFloorKeys={orderedFloorKeys}
        onFloorChange={(room, floor) => env.setFloor(room, floor)}
        currentFloor={(room) => env.rooms[room].floor}
      />

      {/* Per-Room Envelope Editor */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text)]">Room Envelopes</h3>
        {!hasAnyFloor && (
          <p className="text-xs text-[var(--text-muted)]">
            Assign floors above to filter floor/ceiling room dropdowns to adjacent storeys.
          </p>
        )}
        {env.roomNames.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No rooms configured yet.</p>
        )}
        {env.roomNames.map((name) => {
          const rs = env.rooms[name]
          const facing = facingByRoom[name] ?? 'interior'
          const isOpen = expanded === name
          return (
            <div
              key={name}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]"
            >
              <button
                onClick={() => setExpanded(isOpen ? null : name)}
                aria-label={`Expand envelope editor for ${name}`}
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="text-sm font-medium text-[var(--text)]">
                    {name.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {rs.floor !== null ? `Floor ${FLOOR_SHORT[rs.floor] ?? rs.floor}` : 'No floor'}
                    {' · '}
                    facing {facing}
                  </span>
                </div>
                <span className="text-xs text-[var(--text-muted)]">
                  {Object.values(rs.envelope).filter((v) => v !== undefined && v !== null).length}
                  /6 faces
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-[var(--border)] p-4 space-y-3">
                  {(['north_wall', 'east_wall', 'south_wall', 'west_wall', 'floor', 'ceiling'] as FaceKey[]).map(
                    (face) => (
                      <FaceEditorRow
                        key={face}
                        room={name}
                        face={face}
                        facing={facing}
                        value={rs.envelope[face]}
                        isAuto={env.isAutoSet(name, face)}
                        allRooms={env.roomNames}
                        floorByRoom={Object.fromEntries(
                          Object.entries(env.rooms).map(([n, r]) => [n, r.floor]),
                        )}
                        selfFloor={rs.floor}
                        onChangeFace={(v) => env.setFace(name, face, v)}
                        onAddRoom={(ref) => env.addRoomToFace(name, face, ref)}
                        onRemoveRoom={(targetRoom) => env.removeRoomFromFace(name, face, targetRoom)}
                      />
                    ),
                  )}
                  {ambiguousPrompts
                    .filter((p) => p.target === name)
                    .map((p) => (
                      <AmbiguousPrompt
                        key={`${p.source}-${p.sourceFace}`}
                        targetRoom={name}
                        sourceRoom={p.source}
                        envelope={rs.envelope}
                        onChoose={(chosenFace) => {
                          // Clear the auto-populated face, then set user-chosen face.
                          env.setFace(name, p.currentTargetFace, null)
                          env.setFace(name, chosenFace, { room: p.source })
                        }}
                      />
                    ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Summary */}
      <TopologySummary
        env={env.rooms}
      />

      {env.dirty && (
        <div className="flex items-center justify-end gap-2 text-xs text-[var(--text-muted)]">
          <CheckCircle2 size={12} />
          Unsaved changes — click Save Building Layout to apply.
        </div>
      )}
    </div>
  )
}

// ---------- Sub-components ----------

interface FloorAssignmentPanelProps {
  roomsByFloor: Map<number | 'unassigned', string[]>
  orderedFloorKeys: Array<number | 'unassigned'>
  onFloorChange: (room: string, floor: number) => void
  currentFloor: (room: string) => number | null
}

function FloorAssignmentPanel({
  roomsByFloor,
  orderedFloorKeys,
  onFloorChange,
  currentFloor,
}: FloorAssignmentPanelProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <h3 className="text-sm font-semibold text-[var(--text)] mb-3">Floor Assignment</h3>
      <div className="space-y-2">
        {orderedFloorKeys.map((key) => {
          const rooms = roomsByFloor.get(key) ?? []
          const label =
            key === 'unassigned'
              ? 'Unassigned'
              : FLOOR_OPTIONS.find((f) => f.value === key)?.label ?? `Floor ${key}`
          return (
            <div key={String(key)} className="flex items-start gap-3 text-sm">
              <span
                className={cn(
                  'shrink-0 w-20 font-medium',
                  key === 'unassigned' ? 'text-[var(--amber,#d97706)]' : 'text-[var(--text)]',
                )}
              >
                {label}
              </span>
              <div className="flex flex-wrap gap-2">
                {rooms.length === 0 && (
                  <span className="text-xs text-[var(--text-muted)]">—</span>
                )}
                {rooms.map((r) => (
                  <div key={r} className="flex items-center gap-1.5">
                    <span className="text-xs text-[var(--text)]">{r.replace(/_/g, ' ')}</span>
                    <select
                      aria-label={`Floor for ${r}`}
                      value={currentFloor(r) ?? ''}
                      onChange={(e) => onFloorChange(r, parseInt(e.target.value, 10))}
                      className="px-1 py-0.5 rounded border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--text)]"
                    >
                      <option value="" disabled>
                        —
                      </option>
                      {FLOOR_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface FaceEditorRowProps {
  room: string
  face: FaceKey
  facing: string
  value: FaceValue | null | undefined
  isAuto: boolean
  allRooms: string[]
  floorByRoom: Record<string, number | null>
  selfFloor: number | null
  onChangeFace: (v: FaceValue | null) => void
  onAddRoom?: (ref: RoomBoundaryYaml) => void
  onRemoveRoom?: (targetRoom: string) => void
}

type FaceMode = 'surface' | 'rooms'

function FaceEditorRow({
  room,
  face,
  facing,
  value,
  isAuto,
  allRooms,
  floorByRoom,
  selfFloor,
  onChangeFace,
  onAddRoom,
  onRemoveRoom,
}: FaceEditorRowProps) {
  const label = faceLabel(face, facing)
  const literalOpts = literalOptionsForFace(face)
  const selectValue = faceValueToSelectValue(value)

  // Determine mode based on current value
  const mode: FaceMode = hasRoomRefs(value) ? 'rooms' : 'surface'
  const roomRefs = normaliseRefs(value)

  // Candidate rooms depend on face kind and floor alignment.
  const candidateRooms = useMemo(() => {
    const others = allRooms.filter((r) => r !== room)
    const anyFloorAssigned = Object.values(floorByRoom).some((f) => f !== null)
    if (!anyFloorAssigned) return others
    if (face === 'floor') {
      if (selfFloor === null) return others
      return others.filter((r) => floorByRoom[r] === selfFloor - 1)
    }
    if (face === 'ceiling') {
      if (selfFloor === null) return others
      return others.filter((r) => floorByRoom[r] === selfFloor + 1)
    }
    // Walls: same floor only (cross-floor wall adjacency not physically meaningful)
    if (selfFloor === null) return others
    return others.filter((r) => floorByRoom[r] === selfFloor)
  }, [allRooms, floorByRoom, room, face, selfFloor])

  // Filter out already-selected rooms
  const availableRooms = candidateRooms.filter(
    (r) => !roomRefs.some((ref) => ref.room === r)
  )

  const [showConfirm, setShowConfirm] = useState(false)
  const [nextMode, setNextMode] = useState<FaceMode>(mode)

  const handleModeToggle = (newMode: FaceMode) => {
    if (newMode === 'surface' && roomRefs.length >= 2) {
      setNextMode(newMode)
      setShowConfirm(true)
    } else {
      switchMode(newMode)
    }
  }

  const switchMode = (newMode: FaceMode) => {
    if (newMode === 'surface') {
      onChangeFace(null)
    } else {
      onChangeFace(null)
    }
    setShowConfirm(false)
  }

  const handleAddRoom = (selectedRoom: string) => {
    if (!selectedRoom || !onAddRoom) return
    const tp = face === 'ceiling' || face === 'floor' ? 'floor_ceiling' : 'wall'
    onAddRoom({ room: selectedRoom, type: tp })
  }

  const handleRemoveRoom = (targetRoom: string) => {
    if (!onRemoveRoom) return
    onRemoveRoom(targetRoom)
  }

  const handleChipTypeChange = (chipRoom: string, newType: string) => {
    const updated = roomRefs.map((r) =>
      r.room === chipRoom
        ? { room: r.room, type: newType as 'wall' | 'open' | 'party' | 'floor_ceiling' }
        : r
    )
    const newValue: FaceValue = updated.length === 1 ? updated[0] : updated
    onChangeFace(newValue)
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-2 items-start">
        <div className="col-span-3 text-xs text-[var(--text-muted)] pt-1.5">{label}</div>

        {/* Mode toggle */}
        <div className="col-span-4 flex gap-2">
          <button
            onClick={() => handleModeToggle('surface')}
            className={cn(
              'flex-1 px-2 py-1 rounded text-xs font-medium transition-colors',
              mode === 'surface'
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--text)]'
            )}
          >
            Surface
          </button>
          <button
            onClick={() => handleModeToggle('rooms')}
            className={cn(
              'flex-1 px-2 py-1 rounded text-xs font-medium transition-colors',
              mode === 'rooms'
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--text)]'
            )}
          >
            Adjacent Room(s)
          </button>
        </div>

        {isAuto && (
          <div className="col-span-5 text-right">
            <span
              className="text-[10px] text-[var(--accent)] font-medium"
              title="Auto-populated by symmetry"
            >
              (auto)
            </span>
          </div>
        )}
      </div>

      {/* Surface mode: literal dropdown */}
      {mode === 'surface' && (
        <select
          aria-label={`${label} face for ${room}`}
          value={selectValue}
          onChange={(e) => onChangeFace(selectValueToFace(e.target.value))}
          className={cn(
            'w-full px-2 py-1.5 rounded border bg-[var(--bg)] text-sm text-[var(--text)]',
            isAuto
              ? 'border-dashed border-[var(--accent)]/60'
              : 'border-[var(--border)]',
          )}
        >
          <option value="">— Unset —</option>
          <optgroup label="External">
            {literalOpts.map((o) => (
              <option key={o} value={`literal:${o}`}>
                {o[0].toUpperCase() + o.slice(1)}
              </option>
            ))}
          </optgroup>
        </select>
      )}

      {/* Rooms mode: chip list + add dropdown */}
      {mode === 'rooms' && (
        <div className="space-y-2">
          {/* Chip list */}
          {roomRefs.length > 0 && (
            <div className="flex flex-wrap gap-2 p-2 rounded border border-[var(--border)] bg-[var(--bg)] min-h-10">
              {roomRefs.map((ref) => (
                <div
                  key={ref.room}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[var(--bg-card)] border border-[var(--border)]"
                >
                  <span className="text-xs font-medium text-[var(--text)]">
                    {ref.room.replace(/_/g, ' ')}
                  </span>

                  {/* Type control */}
                  {WALL_FACE_KEYS.includes(face) ? (
                    <select
                      value={ref.type ?? 'wall'}
                      onChange={(e) => handleChipTypeChange(ref.room, e.target.value)}
                      className="px-1.5 py-0.5 rounded text-[11px] bg-[var(--bg)] border border-[var(--border)] text-[var(--text)]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value="wall">Wall</option>
                      <option value="open">Open</option>
                      <option value="party">Party</option>
                    </select>
                  ) : (
                    <span className="text-[10px] text-[var(--text-muted)] font-medium">
                      f/c
                    </span>
                  )}

                  {/* Remove button */}
                  <button
                    onClick={() => handleRemoveRoom(ref.room)}
                    className="text-[var(--text-muted)] hover:text-[var(--red)] transition-colors"
                    aria-label={`Remove ${ref.room} from ${label}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add room dropdown */}
          <select
            value=""
            onChange={(e) => handleAddRoom(e.target.value)}
            className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            disabled={availableRooms.length === 0}
          >
            <option value="">
              {availableRooms.length === 0 ? 'No rooms available' : 'Add room…'}
            </option>
            {availableRooms.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="p-3 rounded-lg border border-[var(--amber,#d97706)] bg-[var(--amber,#d97706)]/5 space-y-2">
          <p className="text-sm text-[var(--text)]">
            This will remove {roomRefs.length} room connections and their reciprocals. Continue?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => switchMode(nextMode)}
              className="flex-1 px-2 py-1 rounded text-xs font-medium bg-[var(--amber,#d97706)] text-white hover:opacity-90"
            >
              Confirm
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="flex-1 px-2 py-1 rounded text-xs font-medium bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-card)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface AmbiguousPromptProps {
  targetRoom: string
  sourceRoom: string
  envelope: import('../../types/config').RoomEnvelopeYaml
  onChoose: (face: FaceKey) => void
}

function AmbiguousPrompt({ targetRoom, sourceRoom, envelope, onChoose }: AmbiguousPromptProps) {
  const availableWalls = WALL_FACE_KEYS.filter((w) => {
    const v = envelope[w]
    if (v === undefined || v === null) return true
    // Allow re-selecting the wall already pointing at sourceRoom.
    if (typeof v === 'object' && 'room' in v && v.room === sourceRoom) return true
    return false
  })
  return (
    <div className="flex items-center gap-2 p-2 rounded-md border border-[var(--accent)]/50 bg-[var(--accent)]/5 text-xs">
      <AlertTriangle size={14} className="text-[var(--accent)]" />
      <span className="flex-1">
        <strong>{sourceRoom.replace(/_/g, ' ')}</strong> declared this connection — which wall of{' '}
        <strong>{targetRoom.replace(/_/g, ' ')}</strong>?
      </span>
      <select
        aria-label={`Choose target wall for connection from ${sourceRoom}`}
        defaultValue=""
        onChange={(e) => e.target.value && onChoose(e.target.value as FaceKey)}
        className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-xs"
      >
        <option value="" disabled>
          Choose wall
        </option>
        {availableWalls.map((w, i) => (
          <option key={w} value={w}>
            Wall {i + 1}
          </option>
        ))}
      </select>
    </div>
  )
}

interface TopologySummaryProps {
  env: Record<string, { floor: number | null; envelope: import('../../types/config').RoomEnvelopeYaml }>
}

function TopologySummary({ env }: TopologySummaryProps) {
  const rows = useMemo(() => {
    return Object.entries(env).map(([name, rs]) => {
      const ext = externalFaces(rs.envelope)
      const coupled = coupledTargets(rs.envelope)
      return {
        name,
        floor: rs.floor,
        ext,
        coupled,
      }
    })
  }, [env])

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <h3 className="text-sm font-semibold text-[var(--text)] mb-3">Topology Summary</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
              <th className="py-1.5 pr-3">Room</th>
              <th className="py-1.5 pr-3">Floor</th>
              <th className="py-1.5 pr-3">External faces</th>
              <th className="py-1.5">Coupled to</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const extBits: string[] = []
              if (r.ext.walls > 0)
                extBits.push(`${r.ext.walls} wall${r.ext.walls === 1 ? '' : 's'}`)
              if (r.ext.hasGround) extBits.push('ground (floor)')
              if (r.ext.hasRoof) extBits.push('roof (ceiling)')
              return (
                <tr key={r.name} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-1.5 pr-3 text-[var(--text)]">{r.name.replace(/_/g, ' ')}</td>
                  <td className="py-1.5 pr-3 text-[var(--text-muted)]">
                    {r.floor === null ? '—' : FLOOR_SHORT[r.floor] ?? String(r.floor)}
                  </td>
                  <td className="py-1.5 pr-3 text-[var(--text-muted)]">
                    {extBits.length > 0 ? extBits.join(', ') : '—'}
                  </td>
                  <td className="py-1.5 text-[var(--text-muted)]">
                    {r.coupled.length > 0 ? r.coupled.join(', ') : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

