import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiUrl } from '../lib/api'
import type {
  EnvelopePatchResponse,
  FaceValue,
  RoomBoundaryYaml,
  RoomConfigYaml,
  RoomEnvelopeYaml,
} from '../types/config'
import { normaliseFaceRefs, isSingleRoomRef } from '../types/config'

/** 6-face keys in canonical order. */
export const FACE_KEYS = [
  'north_wall',
  'east_wall',
  'south_wall',
  'west_wall',
  'floor',
  'ceiling',
] as const
export type FaceKey = (typeof FACE_KEYS)[number]

export const WALL_FACE_KEYS: FaceKey[] = [
  'north_wall',
  'east_wall',
  'south_wall',
  'west_wall',
]

const RECIPROCAL_WALL: Record<string, FaceKey> = {
  north_wall: 'south_wall',
  south_wall: 'north_wall',
  east_wall: 'west_wall',
  west_wall: 'east_wall',
}

/** Per-room editable state held by the hook. */
export interface EnvelopeRoomState {
  floor: number | null
  envelope: RoomEnvelopeYaml
}

interface InternalState {
  rooms: Record<string, EnvelopeRoomState>
  /** Faces that were populated by the auto-symmetry engine, for "(auto)" UI hint. */
  autoSet: Record<string, Set<FaceKey>>
}

/** Deep-clone a FaceValue (string literal, RoomBoundaryYaml, or array). */
function cloneFace(face: FaceValue | null | undefined): FaceValue | null {
  if (face === null || face === undefined) return null
  if (typeof face === 'string') return face
  if (Array.isArray(face)) return face.map((r) => ({ room: r.room, type: r.type }))
  return { room: face.room, type: face.type }
}

/** Clone envelope; omits null/undefined faces. */
function cloneEnvelope(env: RoomEnvelopeYaml | undefined): RoomEnvelopeYaml {
  const out: RoomEnvelopeYaml = {}
  if (!env) return out
  for (const k of FACE_KEYS) {
    const v = env[k]
    if (v === undefined || v === null) continue
    out[k] = cloneFace(v as FaceValue)
  }
  return out
}

function getReciprocalWall(face: FaceKey): FaceKey | null {
  return (RECIPROCAL_WALL[face] as FaceKey | undefined) ?? null
}

function firstFreeWall(env: RoomEnvelopeYaml): FaceKey | null {
  for (const w of WALL_FACE_KEYS) {
    if (env[w] === undefined || env[w] === null) return w
  }
  return null
}

/** Infer default boundary type when a wall face is pointed at another room. */
export function inferWallBoundaryType(
  sourceFloor: number | null,
  targetFloor: number | null,
): 'wall' | 'floor_ceiling' {
  if (sourceFloor !== null && targetFloor !== null && sourceFloor !== targetFloor) {
    return 'floor_ceiling'
  }
  return 'wall'
}

/** Pure state transformation: apply a face change with full auto-symmetry logic.
 *  Shared between setFace, addRoomToFace and removeRoomFromFace. */
function applyFace(
  prev: InternalState,
  room: string,
  face: FaceKey,
  value: FaceValue | null,
  sourceFloor: number | null,
): InternalState {
  const cur = prev.rooms[room]
  if (!cur) return prev

  const nextRooms: Record<string, EnvelopeRoomState> = { ...prev.rooms }
  const nextAuto: Record<string, Set<FaceKey>> = {}
  for (const [k, v] of Object.entries(prev.autoSet)) nextAuto[k] = new Set(v)

  const markAuto = (r: string, f: FaceKey, on: boolean) => {
    const set = nextAuto[r] ? new Set(nextAuto[r]) : new Set<FaceKey>()
    if (on) set.add(f)
    else set.delete(f)
    nextAuto[r] = set
  }

  const srcEnv: RoomEnvelopeYaml = { ...cur.envelope }

  markAuto(room, face, false)

  const prevVal = srcEnv[face]

  const inferRef = (ref: RoomBoundaryYaml): RoomBoundaryYaml => {
    if (face === 'floor' || face === 'ceiling') {
      return { room: ref.room, type: 'floor_ceiling' }
    }
    if (WALL_FACE_KEYS.includes(face)) {
      if (ref.type) return { room: ref.room, type: ref.type }
      const peerFloor = prev.rooms[ref.room]?.floor ?? null
      return { room: ref.room, type: inferWallBoundaryType(sourceFloor, peerFloor) }
    }
    return ref
  }

  let committed: FaceValue | null = value
  if (isSingleRoomRef(value)) {
    committed = inferRef(value)
  } else if (Array.isArray(value)) {
    committed = value.map(inferRef)
  }

  const oldRefs = normaliseFaceRefs(prevVal)
  const newRefs = normaliseFaceRefs(committed)
  const removedRefs = oldRefs.filter((o) => !newRefs.some((n) => n.room === o.room))
  const addedRefs = newRefs.filter((n) => !oldRefs.some((o) => o.room === n.room))

  for (const removed of removedRefs) {
    const peerName = removed.room
    const peerPrev = nextRooms[peerName] ?? prev.rooms[peerName]
    if (!peerPrev) continue
    const peerEnv = { ...peerPrev.envelope }
    const reciprocalFace: FaceKey | null =
      face === 'ceiling'
        ? 'floor'
        : face === 'floor'
          ? 'ceiling'
          : getReciprocalWall(face)
    const clearOne = (pf: FaceKey) => {
      const pv = peerEnv[pf]
      const wasAuto = prev.autoSet[peerName]?.has(pf)
      if (!wasAuto) return
      if (isSingleRoomRef(pv) && pv.room === room) {
        delete peerEnv[pf]
        markAuto(peerName, pf, false)
      } else if (Array.isArray(pv)) {
        const filtered = pv.filter((r) => r.room !== room)
        if (filtered.length === 0) {
          delete peerEnv[pf]
          markAuto(peerName, pf, false)
        } else if (filtered.length !== pv.length) {
          peerEnv[pf] = filtered.length === 1 ? filtered[0] : filtered
        }
      }
    }
    if (reciprocalFace) {
      clearOne(reciprocalFace)
    } else {
      for (const pf of WALL_FACE_KEYS) clearOne(pf)
    }
    nextRooms[peerName] = { ...peerPrev, envelope: peerEnv }
  }

  if (committed === null) {
    delete srcEnv[face]
  } else {
    srcEnv[face] = committed
  }
  nextRooms[room] = { ...cur, envelope: srcEnv }

  for (const added of addedRefs) {
    const peerName = added.room
    const peerPrev = nextRooms[peerName] ?? prev.rooms[peerName]
    if (!peerPrev) continue
    const peerEnv = { ...peerPrev.envelope }
    let peerFace: FaceKey | null = null
    if (face === 'ceiling') peerFace = 'floor'
    else if (face === 'floor') peerFace = 'ceiling'
    else {
      const reciprocal = getReciprocalWall(face)
      if (reciprocal) {
        const occupant = peerEnv[reciprocal]
        if (occupant === undefined || occupant === null) {
          peerFace = reciprocal
        } else if (isSingleRoomRef(occupant) && occupant.room === room) {
          peerFace = null
        } else if (Array.isArray(occupant) && occupant.some((r) => r.room === room)) {
          peerFace = null
        } else {
          peerFace = firstFreeWall(peerEnv)
        }
      } else {
        peerFace = firstFreeWall(peerEnv)
      }
    }

    if (peerFace) {
      const peerVal: RoomBoundaryYaml =
        peerFace === 'floor' || peerFace === 'ceiling'
          ? { room, type: 'floor_ceiling' }
          : { room, type: inferWallBoundaryType(peerPrev.floor, sourceFloor) }
      peerEnv[peerFace] = peerVal
      nextRooms[peerName] = { ...peerPrev, envelope: peerEnv }
      markAuto(peerName, peerFace, true)
    }
  }

  return { rooms: nextRooms, autoSet: nextAuto }
}

/** Derive initial editable state from raw YAML rooms. */
function initialStateFrom(
  rooms: Record<string, RoomConfigYaml> | undefined,
): InternalState {
  const out: Record<string, EnvelopeRoomState> = {}
  if (rooms) {
    for (const [name, cfg] of Object.entries(rooms)) {
      out[name] = {
        floor: typeof cfg.floor === 'number' ? cfg.floor : null,
        envelope: cloneEnvelope(cfg.envelope),
      }
    }
  }
  return { rooms: out, autoSet: {} }
}

export interface UseEnvelopeArgs {
  /** Raw rooms snapshot from useRawConfig — the hook derives its initial state from this. */
  rooms: Record<string, RoomConfigYaml> | undefined
  /** Called after a successful save so the parent can refetch raw config. */
  onSaved?: () => void
}

export interface UseEnvelopeResult {
  rooms: Record<string, EnvelopeRoomState>
  roomNames: string[]
  /** Set the storey for a room (−1..5). */
  setFloor: (room: string, floor: number) => void
  /** Set a face value; applies auto-symmetry and auto-inference for room refs. */
  setFace: (room: string, face: FaceKey, value: FaceValue | null) => void
  /** Append a room ref to a face (multi-room support). Dedups; caps at 10 refs. */
  addRoomToFace: (room: string, face: FaceKey, ref: RoomBoundaryYaml) => void
  /** Remove a room ref from a face. Collapses to scalar when one ref remains, null when empty. */
  removeRoomFromFace: (room: string, face: FaceKey, targetRoom: string) => void
  /** Returns true when the face was populated by the auto-symmetry engine. */
  isAutoSet: (room: string, face: FaceKey) => boolean
  save: () => Promise<EnvelopePatchResponse | null>
  saving: boolean
  dirty: boolean
  warnings: string[]
  error: string | null
}

/** Envelope state editor hook (INSTRUCTION-106B).
 *
 *  Auto-symmetry: when the user sets a face that references another room, the
 *  reciprocal face on the peer is auto-populated where it is deterministic
 *  (ceiling↔floor, compass-reciprocal walls, or the first free wall when the
 *  compass reciprocal is occupied). The component is expected to surface a
 *  prompt when the target wall assignment is non-deterministic.
 *
 *  Auto-inference: wall↔room type defaults to `wall` (same floor) or
 *  `floor_ceiling` (different floor). Floor/ceiling→room is always
 *  `floor_ceiling`.
 */
export function useEnvelope({ rooms, onSaved }: UseEnvelopeArgs): UseEnvelopeResult {
  const [state, setState] = useState<InternalState>(() => initialStateFrom(rooms))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  // Re-hydrate from incoming rooms when they change — but only while not dirty.
  // Once the user edits we hold local state until save().
  useEffect(() => {
    if (!dirty) setState(initialStateFrom(rooms))
  }, [rooms, dirty])

  const roomNames = useMemo(() => Object.keys(state.rooms), [state.rooms])

  const setFloor = useCallback((room: string, floor: number) => {
    setState((prev) => {
      const cur = prev.rooms[room]
      if (!cur) return prev
      return {
        ...prev,
        rooms: { ...prev.rooms, [room]: { ...cur, floor } },
      }
    })
    setDirty(true)
  }, [])

  const setFace = useCallback((room: string, face: FaceKey, value: FaceValue | null) => {
    setState((prev) => {
      const cur = prev.rooms[room]
      if (!cur) return prev
      return applyFace(prev, room, face, value, cur.floor)
    })
    setDirty(true)
  }, [])

  const addRoomToFace = useCallback(
    (room: string, face: FaceKey, ref: RoomBoundaryYaml) => {
      setState((prev) => {
        const cur = prev.rooms[room]
        if (!cur) return prev

        const currentRefs = normaliseFaceRefs(cur.envelope[face])
        if (currentRefs.length >= 10) return prev
        if (currentRefs.some((r) => r.room === ref.room)) return prev

        const newRefs = [...currentRefs, { room: ref.room, type: ref.type }]
        const newValue: FaceValue = newRefs.length === 1 ? newRefs[0] : newRefs
        return applyFace(prev, room, face, newValue, cur.floor)
      })
      setDirty(true)
    },
    [],
  )

  const removeRoomFromFace = useCallback(
    (room: string, face: FaceKey, targetRoom: string) => {
      setState((prev) => {
        const cur = prev.rooms[room]
        if (!cur) return prev

        const currentRefs = normaliseFaceRefs(cur.envelope[face])
        const filtered = currentRefs.filter((r) => r.room !== targetRoom)
        if (filtered.length === currentRefs.length) return prev

        const newValue: FaceValue | null =
          filtered.length === 0
            ? null
            : filtered.length === 1
              ? filtered[0]
              : filtered
        return applyFace(prev, room, face, newValue, cur.floor)
      })
      setDirty(true)
    },
    [],
  )

  const isAutoSet = useCallback(
    (room: string, face: FaceKey) => !!state.autoSet[room]?.has(face),
    [state.autoSet],
  )

  const save = useCallback(async (): Promise<EnvelopePatchResponse | null> => {
    setSaving(true)
    setError(null)
    try {
      const body: { rooms: Record<string, { floor?: number; envelope?: RoomEnvelopeYaml }> } = {
        rooms: {},
      }
      for (const [name, rs] of Object.entries(state.rooms)) {
        const entry: { floor?: number; envelope?: RoomEnvelopeYaml } = {}
        if (rs.floor !== null) entry.floor = rs.floor
        if (Object.keys(rs.envelope).length > 0) entry.envelope = rs.envelope
        body.rooms[name] = entry
      }

      const resp = await fetch(apiUrl('api/rooms/envelope'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }
      const payload = (await resp.json()) as EnvelopePatchResponse
      setWarnings(payload.warnings ?? [])
      setDirty(false)
      setState((prev) => ({ ...prev, autoSet: {} }))
      onSaved?.()
      return payload
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      return null
    } finally {
      setSaving(false)
    }
  }, [state, onSaved])

  return {
    rooms: state.rooms,
    roomNames,
    setFloor,
    setFace,
    addRoomToFace,
    removeRoomFromFace,
    isAutoSet,
    save,
    saving,
    dirty,
    warnings,
    error,
  }
}
