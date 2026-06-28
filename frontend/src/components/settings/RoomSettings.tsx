import { useState, useMemo, useCallback } from 'react'
import { Plus, Trash2, Save, Loader2, X } from 'lucide-react'
import { usePatchConfig } from '../../hooks/useConfig'
import { useEntityResolve } from '../../hooks/useEntityResolve'
import { FACING_OPTIONS, type RoomConfigYaml, type RoomMqttTopicValue, type Driver, type AuxiliaryOutputYaml, type PropertyYaml, type FabricClass } from '../../types/config'
import { stripFixedSetpointForControlMode } from '../../lib/roomConfig'
import { EntityField } from './EntityField'
import { TopicField } from './TopicField'
import { AuxOutputEditor } from './AuxOutputEditor'

// INSTRUCTION-335 — the wizard property band (qsh/api/routes/wizard.py:51-52,
// 58, 69-70). Area band is a dirty-scoped client save-gate; bedrooms band and
// the Σ-area reconciliation are soft, non-blocking warnings.
const PROPERTY_AREA_MIN_M2 = 30
const PROPERTY_AREA_MAX_M2 = 1000
const BEDROOMS_MIN = 0
const BEDROOMS_MAX = 12
const AREA_RECONCILIATION_TOLERANCE = 0.25

// INSTRUCTION-369 — build-year soft band (mirrors the backend 368 loader
// _resolve_building_class [1700, current_year]). Soft on both layers: the
// frontend shows a non-blocking warning, the root PATCH accepts (no 4xx), and
// the 368 loader warn-and-unsets an out-of-band value on adoption.
const CONSTRUCTION_YEAR_MIN = 1700

// INSTRUCTION-369 — Taxonomy-V1 §3.5 fabric-class enum MINUS the literal
// `unknown`. Absent already derives uk_unclassified downstream (QS-085 §4.1 /
// 085B §3); offering both an empty "Not set" default AND a literal `unknown`
// option would be two labels for indistinguishable states. The empty option is
// the single absent-path.
const FABRIC_CLASS_OPTIONS: { value: Exclude<FabricClass, 'unknown'>; label: string }[] = [
  { value: 'solid_wall', label: 'Solid wall' },
  { value: 'cavity_unfilled', label: 'Cavity — unfilled' },
  { value: 'cavity_filled', label: 'Cavity — filled' },
  { value: 'timber_frame', label: 'Timber frame' },
  { value: 'sip', label: 'SIP (structural insulated panel)' },
  { value: 'mixed', label: 'Mixed' },
]

/** Building-class edit state (INSTRUCTION-369). null = cleared/absent — sent as
 *  null in the root PATCH so the backend pops the key (a cleared field unsets
 *  rather than merge-preserving the prior value). A stored literal `unknown`
 *  fabric_class is seeded verbatim and rides through the payload unchanged
 *  (benign: `unknown` ≡ absent downstream). */
interface BuildingState {
  construction_year: number | null
  fabric_class: string | null
}

interface RoomSettingsProps {
  rooms: Record<string, RoomConfigYaml>
  // INSTRUCTION-335 (P-5): the owner-declared building ground truth, surfaced
  // for edit-after-setup. Optional so existing callers/tests that pre-date
  // this change still type-check; absent ⇒ {} (a pre-324 install).
  property?: PropertyYaml
  // INSTRUCTION-369 — top-level building-class scalars (368), surfaced for
  // post-setup edit in the Property box. Optional; absent ⇒ unset. Edited as
  // root keys via PATCH /api/config/root, NOT as `property` members.
  construction_year?: number
  fabric_class?: FabricClass
  driver: Driver
  onRefetch: () => void
}

/** Apply the on-save room transforms to a whole rooms map. Used both for the
 *  PATCH payload and — applied to BOTH sides — for the dirty compare, so the
 *  gate is like-with-like (INSTRUCTION-335 §8 handoff-1) rather than reading
 *  perpetually dirty because the payload is transformed and the baseline isn't. */
function cleanRoomsMap(
  m: Record<string, RoomConfigYaml>,
): Record<string, RoomConfigYaml> {
  return Object.fromEntries(
    Object.entries(m).map(([n, r]) => [
      n,
      stripFixedSetpointForControlMode(stripEmptyMqttTopics(r)),
    ]),
  )
}

/** Extract the topic string from a RoomMqttTopicValue (string or MqttTopicInput object). */
function getTopicString(v: RoomMqttTopicValue | undefined): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  return v.topic ?? ''
}

/** Set the topic string, preserving MqttTopicInput metadata if the previous value was an object. */
function setTopicString(prev: RoomMqttTopicValue | undefined, topic: string): RoomMqttTopicValue | undefined {
  if (!topic) return undefined
  if (prev && typeof prev === 'object') {
    return { ...prev, topic }
  }
  return topic
}

/** Multi-emitter test — true when trv_entity is a list of two or more entries.
 *  Pure: no closures over component state. Module-scope per §Helper placement. */
function isMultiEmitter(trv: RoomConfigYaml['trv_entity']): boolean {
  return Array.isArray(trv) && trv.length >= 2
}

/** Drop keys whose value is an empty string or empty MqttTopicInput; drop the
 *  whole mqtt_topics object if nothing non-empty remains. Returns a new room.
 *  INSTRUCTION-224E: also handles list-form valve_position — kept as-is when
 *  at least one entry is non-empty, dropped entirely otherwise. Single-element
 *  lists are not re-collapsed here; the in-component setters already normalise
 *  shape (single → scalar) so a list reaching this helper is always length >= 2
 *  or has an empty placeholder slot. */
function stripEmptyMqttTopics(room: RoomConfigYaml): RoomConfigYaml {
  if (!room.mqtt_topics) return room
  const cleaned: Record<string, RoomMqttTopicValue | string[]> = {}
  for (const [k, v] of Object.entries(room.mqtt_topics)) {
    if (Array.isArray(v)) {
      // Keep the list verbatim if any entry is non-empty.
      if (v.some((t) => typeof t === 'string' && t.trim())) {
        cleaned[k] = v as string[]
      }
      continue
    }
    const s = getTopicString(v)
    if (s) cleaned[k] = v as RoomMqttTopicValue
  }
  if (Object.keys(cleaned).length === 0) {
    const copy = { ...room }
    delete copy.mqtt_topics
    return copy
  }
  return { ...room, mqtt_topics: cleaned as RoomConfigYaml['mqtt_topics'] }
}

export function RoomSettings({ rooms, property, construction_year, fabric_class, driver, onRefetch }: RoomSettingsProps) {
  const [editedRooms, setEditedRooms] = useState<Record<string, RoomConfigYaml>>(rooms)
  const [propertyState, setPropertyState] = useState<PropertyYaml>(property ?? {})
  // INSTRUCTION-369 — building-class edit state, seeded verbatim from the
  // top-level root keys (a stored `unknown` is held as-is, not normalised).
  const [buildingState, setBuildingState] = useState<BuildingState>({
    construction_year: construction_year ?? null,
    fabric_class: fabric_class ?? null,
  })
  const [saveError, setSaveError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const { patch, saving } = usePatchConfig()
  // INSTRUCTION-162A: per-room aux validity. False means the AuxOutputEditor
  // has reported an invalid state (e.g. enabled with empty target field) and
  // the parent Save button must be disabled to avoid a guaranteed 422.
  // Default-valid: rooms not present in the map are assumed valid.
  const [auxValidByRoom, setAuxValidByRoom] = useState<Record<string, boolean>>({})
  const allValid = Object.values(auxValidByRoom).every((v) => v !== false)

  const allEntityIds = useMemo(
    () => {
      if (driver === 'mqtt') return []
      return Object.values(editedRooms).flatMap((room) => {
        const trvs = Array.isArray(room.trv_entity) ? room.trv_entity : room.trv_entity ? [room.trv_entity] : []
        return [
          ...trvs,
          room.independent_sensor,
          room.heating_entity,
          room.occupancy_sensor,
        ]
      }).filter(Boolean) as string[]
    },
    [editedRooms, driver]
  )
  const { resolved } = useEntityResolve(allEntityIds, driver)

  const updateRoom = useCallback((name: string, changes: Partial<RoomConfigYaml>) => {
    setEditedRooms((prev) => ({
      ...prev,
      [name]: { ...prev[name], ...changes },
    }))
  }, [])

  /** Get the primary TRV entity (first element if array). */
  const getPrimaryTrv = useCallback((room: RoomConfigYaml): string => {
    const trv = room.trv_entity
    if (!trv) return ''
    return Array.isArray(trv) ? trv[0] || '' : trv
  }, [])

  /** Get additional TRV entities (2nd+ elements). */
  const getExtraTrvs = useCallback((room: RoomConfigYaml): string[] => {
    const trv = room.trv_entity
    if (!trv || !Array.isArray(trv)) return []
    return trv.slice(1)
  }, [])

  /** Update TRV entity at a specific index. */
  const updateTrvAt = useCallback((roomName: string, index: number, value: string) => {
    const room = editedRooms[roomName]
    const current = room.trv_entity
    let arr: string[]
    if (!current) {
      arr = []
    } else if (Array.isArray(current)) {
      arr = [...current]
    } else {
      arr = [current]
    }

    if (value) {
      arr[index] = value
    } else {
      arr.splice(index, 1)
    }

    // Normalise: single-element array → string, empty → undefined
    const normalised = arr.length === 0 ? undefined : arr.length === 1 ? arr[0] : arr
    updateRoom(roomName, { trv_entity: normalised })
  }, [editedRooms, updateRoom])

  /** Add an additional TRV slot. */
  const addTrvSlot = useCallback((roomName: string) => {
    const room = editedRooms[roomName]
    const current = room.trv_entity
    let arr: string[]
    if (!current) {
      arr = ['', '']
    } else if (Array.isArray(current)) {
      arr = [...current, '']
    } else {
      arr = [current, '']
    }
    updateRoom(roomName, { trv_entity: arr })
  }, [editedRooms, updateRoom])

  // INSTRUCTION-231D — heating_entity multi-emitter helpers. Mirror the
  // 224A trv_entity helpers above but with the V2 MEDIUM-1 unified pad-
  // and-set pattern in updateHeatingAt (eliminates the scalar+index>=2
  // value-drop bug). Same normalisation: single-element array → scalar,
  // empty → undefined.

  /** Get the primary heating entity (first element if array). */
  const getPrimaryHeating = useCallback((room: RoomConfigYaml): string => {
    const he = room.heating_entity
    if (!he) return ''
    return Array.isArray(he) ? he[0] || '' : he
  }, [])

  /** Get additional heating entities (2nd+ elements). */
  const getExtraHeatings = useCallback((room: RoomConfigYaml): string[] => {
    const he = room.heating_entity
    if (!he || !Array.isArray(he)) return []
    return he.slice(1)
  }, [])

  /** Update one heating_entity slot at the given index.
   *  V2 MEDIUM-1 fix: unified pad-and-set pattern handles scalar, array,
   *  and undefined input shapes uniformly. Pre-V2 the scalar branch only
   *  handled index 0/1, silently dropping typing at index >= 2. */
  const updateHeatingAt = useCallback(
    (roomName: string, index: number, value: string) => {
      const room = editedRooms[roomName]
      const current = room.heating_entity
      // Normalise to array upfront — eliminates special-case branches.
      let arr: string[]
      if (!current) arr = []
      else if (Array.isArray(current)) arr = [...current]
      else arr = [current] // scalar → length-1 array
      // Pad with empties up to the index, then set.
      while (arr.length <= index) arr.push('')
      arr[index] = value
      // Trim trailing empty strings before normalising.
      while (arr.length > 0 && arr[arr.length - 1] === '') arr.pop()
      const normalised =
        arr.length === 0 ? undefined : arr.length === 1 ? arr[0] : arr
      updateRoom(roomName, { heating_entity: normalised })
    },
    [editedRooms, updateRoom],
  )

  /** Append a new heating_entity slot. */
  const addHeatingSlot = useCallback(
    (roomName: string) => {
      const room = editedRooms[roomName]
      const current = room.heating_entity
      let arr: string[]
      if (!current) arr = ['']
      else if (Array.isArray(current)) arr = [...current, '']
      else arr = [current, '']
      updateRoom(roomName, { heating_entity: arr })
    },
    [editedRooms, updateRoom],
  )

  /** Remove the emitter row at the given index (paired removal of both
   *  trv and heating slots simultaneously). The backend's independent-list
   *  contract is preserved — if either list is shorter than the row
   *  index, only the longer side is trimmed. */
  const removeEmitterSlot = useCallback(
    (roomName: string, index: number) => {
      const room = editedRooms[roomName]
      const trvCurrent = room.trv_entity
      const heCurrent = room.heating_entity

      const trvArr = !trvCurrent
        ? []
        : Array.isArray(trvCurrent)
          ? [...trvCurrent]
          : [trvCurrent]
      const heArr = !heCurrent
        ? []
        : Array.isArray(heCurrent)
          ? [...heCurrent]
          : [heCurrent]

      if (index < trvArr.length) trvArr.splice(index, 1)
      if (index < heArr.length) heArr.splice(index, 1)

      while (trvArr.length > 0 && trvArr[trvArr.length - 1] === '') trvArr.pop()
      while (heArr.length > 0 && heArr[heArr.length - 1] === '') heArr.pop()

      const trvNormalised =
        trvArr.length === 0 ? undefined : trvArr.length === 1 ? trvArr[0] : trvArr
      const heNormalised =
        heArr.length === 0 ? undefined : heArr.length === 1 ? heArr[0] : heArr

      updateRoom(roomName, {
        trv_entity: trvNormalised,
        heating_entity: heNormalised,
      })
    },
    [editedRooms, updateRoom],
  )

  // INSTRUCTION-224E — MQTT valve_position list-form helpers. Mirror the
  // HA-side getPrimaryTrv / getExtraTrvs / updateTrvAt / addTrvSlot cluster
  // above; same normalisation rules (single-element list → scalar, empty
  // list → undefined). The valve_position value may be a string, a
  // RoomMqttTopicValue object (legacy with format/json_path), or a list
  // of strings. List-form is the only multi-emitter shape; lists of
  // MqttTopicInput objects are not supported (operator drops to scalar
  // edit for JSON-payload single-topic case).

  /** True when valve_position is a list of length >= 2 (multi-emitter MQTT). */
  const isMultiPositionTopic = useCallback((room: RoomConfigYaml): boolean => {
    const vp = room.mqtt_topics?.valve_position
    return Array.isArray(vp) && vp.length >= 2
  }, [])

  /** Primary valve_position topic — first list element, or the scalar itself. */
  const getPrimaryValvePositionTopic = useCallback((room: RoomConfigYaml): string => {
    const vp = room.mqtt_topics?.valve_position
    if (!vp) return ''
    if (Array.isArray(vp)) return vp[0] ?? ''
    if (typeof vp === 'string') return vp
    return vp.topic ?? ''
  }, [])

  /** Additional valve_position topics (2nd+ list elements). */
  const getExtraValvePositionTopics = useCallback((room: RoomConfigYaml): string[] => {
    const vp = room.mqtt_topics?.valve_position
    if (!Array.isArray(vp)) return []
    return vp.slice(1)
  }, [])

  /** Update valve_position topic at a specific index. Normalises shape:
   *  empty list → undefined, single-element list → scalar string. */
  const updateValvePositionAt = useCallback((roomName: string, index: number, value: string) => {
    const room = editedRooms[roomName]
    const current = room.mqtt_topics?.valve_position
    let arr: string[]
    if (!current) {
      arr = []
    } else if (Array.isArray(current)) {
      arr = [...current]
    } else if (typeof current === 'string') {
      arr = [current]
    } else {
      arr = [current.topic ?? '']
    }

    if (value) {
      arr[index] = value
    } else {
      arr.splice(index, 1)
    }

    const normalised: string | string[] | undefined =
      arr.length === 0 ? undefined : arr.length === 1 ? arr[0] : arr
    updateRoom(roomName, {
      mqtt_topics: { ...(room.mqtt_topics ?? {}), valve_position: normalised },
    })
  }, [editedRooms, updateRoom])

  /** Add an additional valve_position topic slot. */
  const addValvePositionSlot = useCallback((roomName: string) => {
    const room = editedRooms[roomName]
    const current = room.mqtt_topics?.valve_position
    let arr: string[]
    if (!current) {
      arr = ['', '']
    } else if (Array.isArray(current)) {
      arr = [...current, '']
    } else if (typeof current === 'string') {
      arr = [current, '']
    } else {
      arr = [current.topic ?? '', '']
    }
    updateRoom(roomName, {
      mqtt_topics: { ...(room.mqtt_topics ?? {}), valve_position: arr },
    })
  }, [editedRooms, updateRoom])

  /** Remove the valve_position topic at the given index. Re-normalises shape. */
  const removeValvePositionAt = useCallback((roomName: string, index: number) => {
    const room = editedRooms[roomName]
    const current = room.mqtt_topics?.valve_position
    if (!Array.isArray(current)) return
    const arr = [...current]
    arr.splice(index, 1)
    const normalised: string | string[] | undefined =
      arr.length === 0 ? undefined : arr.length === 1 ? arr[0] : arr
    updateRoom(roomName, {
      mqtt_topics: { ...(room.mqtt_topics ?? {}), valve_position: normalised },
    })
  }, [editedRooms, updateRoom])

  /** Clear legacy HA fields for a room (on MQTT driver). */
  const clearLegacyHaFields = useCallback((name: string) => {
    updateRoom(name, {
      trv_entity: undefined,
      independent_sensor: undefined,
      heating_entity: undefined,
      occupancy_sensor: undefined,
    })
  }, [updateRoom])

  const addRoom = () => {
    const name = newName.trim().toLowerCase().replace(/\s+/g, '_')
    if (!name || editedRooms[name]) return
    setEditedRooms({
      ...editedRooms,
      [name]: { area_m2: 15, facing: 'interior', ceiling_m: 2.4 },
    })
    setNewName('')
  }

  const deleteRoom = (name: string) => {
    setEditedRooms((prev) => {
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  // ── Property dirty-gate + soft warnings (INSTRUCTION-335) ──
  const initialProperty = property ?? {}
  const propertyDirty =
    JSON.stringify(propertyState) !== JSON.stringify(initialProperty)
  const area = propertyState.total_floor_area_m2
  const areaInBand =
    typeof area === 'number' &&
    Number.isFinite(area) &&
    area >= PROPERTY_AREA_MIN_M2 &&
    area <= PROPERTY_AREA_MAX_M2
  // Dirty-scoped (M-2): an untouched/absent declaration never blocks Save; an
  // *edited* declaration must carry a valid in-band area.
  const areaGateBlocks = propertyDirty && !areaInBand
  const bedrooms = propertyState.bedrooms
  const bedroomsWarn =
    typeof bedrooms === 'number' &&
    (bedrooms < BEDROOMS_MIN || bedrooms > BEDROOMS_MAX)
  // Σ-area reconciliation — soft, non-blocking, ÷0-guarded.
  const sumRoomArea = Object.values(editedRooms).reduce(
    (s, r) => s + (typeof r.area_m2 === 'number' ? r.area_m2 : 0),
    0,
  )
  const reconcileWarn =
    typeof area === 'number' &&
    area > 0 &&
    Math.abs(sumRoomArea - area) / area > AREA_RECONCILIATION_TOLERANCE

  // ── Building-class dirty-gate + soft year warning (INSTRUCTION-369) ──
  const initialBuilding: BuildingState = {
    construction_year: construction_year ?? null,
    fabric_class: fabric_class ?? null,
  }
  const buildingDirty =
    JSON.stringify(buildingState) !== JSON.stringify(initialBuilding)
  const currentYear = new Date().getFullYear()
  const buildYear = buildingState.construction_year
  const buildYearWarn =
    typeof buildYear === 'number' &&
    Number.isFinite(buildYear) &&
    (buildYear < CONSTRUCTION_YEAR_MIN || buildYear > currentYear)
  // Controlled-select fidelity: render "Not set" for a stored value not in the
  // offered set (e.g. a literal `unknown`) WITHOUT writing the empty value back
  // into buildingState — only an active operator change mutates state. The
  // computed value always matches an existing <option> (a real fabric or the
  // empty "Not set"), so the controlled select never has an unmatched value.
  const fabricSelectValue =
    buildingState.fabric_class &&
    FABRIC_CLASS_OPTIONS.some((o) => o.value === buildingState.fabric_class)
      ? buildingState.fabric_class
      : ''

  // Rooms dirty-gate — clean BOTH sides (handoff-1).
  const cleanedRooms = cleanRoomsMap(editedRooms)
  const roomsDirty =
    JSON.stringify(cleanedRooms) !== JSON.stringify(cleanRoomsMap(rooms))

  const save = async () => {
    setSaveError(null)
    // §1.1: dirty-gated, whole-section, serialized awaits, order rooms →
    // property, abort on first failure (no later PATCH, no onRefetch).
    if (roomsDirty) {
      let ok = false
      try {
        ok = Boolean(await patch('rooms', cleanedRooms))
      } catch {
        ok = false
      }
      if (!ok) {
        setSaveError('Failed to save rooms. Your changes have not been applied.')
        return
      }
    }
    if (propertyDirty) {
      let ok = false
      try {
        ok = Boolean(await patch('property', propertyState))
      } catch {
        ok = false
      }
      if (!ok) {
        setSaveError('Failed to save property declaration. Your changes have not been applied.')
        return
      }
    }
    // INSTRUCTION-369 — third step: top-level building-class keys via the
    // `root` PATCH (merge — siblings survive). Same abort-on-first-failure
    // contract; fires only when dirty. Sends both keys (null = clear/pop); a
    // seeded `unknown` rides through unchanged (benign, `unknown` ≡ absent).
    if (buildingDirty) {
      let ok = false
      try {
        ok = Boolean(await patch('root', buildingState))
      } catch {
        ok = false
      }
      if (!ok) {
        setSaveError('Failed to save building details. Your changes have not been applied.')
        return
      }
    }
    onRefetch()
  }

  /** Check if a room has any legacy HA entity fields set. */
  const hasLegacyHaFields = (room: RoomConfigYaml): boolean =>
    !!(room.trv_entity || room.independent_sensor || room.heating_entity || room.occupancy_sensor)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">Rooms</h2>
        <button
          onClick={save}
          disabled={saving || !allValid || areaGateBlocks}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      {saveError && (
        <div
          role="alert"
          className="px-4 py-3 rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 text-sm text-[var(--text)]"
        >
          <div className="flex items-start gap-2">
            <span className="flex-1">{saveError}</span>
            <button
              type="button"
              onClick={() => setSaveError(null)}
              aria-label="Dismiss error"
              className="text-[var(--text-muted)] hover:text-[var(--text)] shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* INSTRUCTION-335 — Property declaration (parity with StepRooms). The
          area band is a dirty-scoped client save-gate; the bedrooms band and
          the Σ-area reconciliation are soft, non-blocking warnings. The wizard
          remains the hard reconciliation gate at deploy. */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
        <h3 className="text-sm font-medium text-[var(--text)]">Property</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="property-total-area"
              className="block text-xs font-medium text-[var(--text)] mb-1"
            >
              Total Floor Area (m²)
            </label>
            <input
              id="property-total-area"
              type="number"
              step="1"
              min={PROPERTY_AREA_MIN_M2}
              max={PROPERTY_AREA_MAX_M2}
              value={propertyState.total_floor_area_m2 ?? ''}
              onChange={(e) =>
                setPropertyState((prev) => ({
                  ...prev,
                  total_floor_area_m2: e.target.value
                    ? parseFloat(e.target.value)
                    : undefined,
                }))
              }
              placeholder="e.g. 189"
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
            {areaGateBlocks && (
              <p className="mt-1 text-xs text-[var(--red)]">
                Enter a total floor area between {PROPERTY_AREA_MIN_M2} and{' '}
                {PROPERTY_AREA_MAX_M2} m² to save the declaration.
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="property-bedrooms"
              className="block text-xs font-medium text-[var(--text)] mb-1"
            >
              Bedrooms — optional
            </label>
            <input
              id="property-bedrooms"
              type="number"
              step="1"
              min={BEDROOMS_MIN}
              max={BEDROOMS_MAX}
              value={propertyState.bedrooms ?? ''}
              onChange={(e) =>
                setPropertyState((prev) => ({
                  ...prev,
                  bedrooms: e.target.value
                    ? parseInt(e.target.value, 10)
                    : undefined,
                }))
              }
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
            {bedroomsWarn && (
              <p className="mt-1 text-xs text-[var(--amber)]">
                Outside the typical range {BEDROOMS_MIN}–{BEDROOMS_MAX} — saved anyway.
              </p>
            )}
          </div>
        </div>
        {/* INSTRUCTION-369 — top-level building-class scalars (368), editable
            post-setup. Build year is a soft band (non-blocking warning, mirrors
            the bedrooms soft-band — NOT the area hard-gate); material is the
            §3.5 enum minus the literal `unknown`, with an empty "Not set". */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="building-construction-year"
              className="block text-xs font-medium text-[var(--text)] mb-1"
            >
              Build Year — optional
            </label>
            <input
              id="building-construction-year"
              type="number"
              step="1"
              min={CONSTRUCTION_YEAR_MIN}
              max={currentYear}
              value={buildingState.construction_year ?? ''}
              onChange={(e) =>
                setBuildingState((prev) => ({
                  ...prev,
                  construction_year: e.target.value
                    ? parseInt(e.target.value, 10)
                    : null,
                }))
              }
              placeholder="e.g. 2016"
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
            {buildYearWarn && (
              <p className="mt-1 text-xs text-[var(--amber)]">
                Outside the typical range {CONSTRUCTION_YEAR_MIN}–{currentYear} — saved anyway.
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="building-fabric-class"
              className="block text-xs font-medium text-[var(--text)] mb-1"
            >
              Material — optional
            </label>
            <select
              id="building-fabric-class"
              value={fabricSelectValue}
              onChange={(e) =>
                setBuildingState((prev) => ({
                  ...prev,
                  fabric_class: e.target.value || null,
                }))
              }
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            >
              <option value="">Not set</option>
              {FABRIC_CLASS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {reconcileWarn && (
          <p className="text-xs text-[var(--amber)]">
            Declared floor area differs from the sum of room areas by more than{' '}
            {Math.round(AREA_RECONCILIATION_TOLERANCE * 100)}%. Check the room
            areas or the declared total.
          </p>
        )}
      </div>

      {/* Add room */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New room name"
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
          onKeyDown={(e) => e.key === 'Enter' && addRoom()}
        />
        <button
          onClick={addRoom}
          disabled={!newName.trim()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--bg)] disabled:opacity-50"
        >
          <Plus size={14} />
          Add
        </button>
      </div>

      {/* Room list */}
      <div className="space-y-3">
        {Object.entries(editedRooms).map(([name, room]) => (
          <div
            key={name}
            className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[var(--text)]">
                {name.replace(/_/g, ' ')}
              </h3>
              <button
                onClick={() => deleteRoom(name)}
                className="text-[var(--text-muted)] hover:text-[var(--red)]"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  Area (m²)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={room.area_m2}
                  onChange={(e) =>
                    updateRoom(name, { area_m2: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  Ceiling (m)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={room.ceiling_m ?? 2.4}
                  onChange={(e) =>
                    updateRoom(name, { ceiling_m: parseFloat(e.target.value) || 2.4 })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  Facing
                </label>
                <select
                  value={room.facing || 'interior'}
                  onChange={(e) => updateRoom(name, { facing: e.target.value })}
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                >
                  {FACING_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  Emitter (kW)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={room.emitter_kw ?? ''}
                  disabled={room.emitter_type === 'none'}
                  onChange={(e) =>
                    updateRoom(name, {
                      emitter_kw: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  placeholder="Auto"
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] disabled:opacity-50"
                />
              </div>
              {/* Emitter type — INSTRUCTION-333 parity: the sole per-room τ
                  lever, editable after setup (StepRooms↔RoomSettings parity).
                  'None' couples identically to the wizard: forces emitter_kw 0;
                  switching away clears it (undefined dropped by JSON.stringify,
                  full-section overwrite by restore_redacted, area×0.1 re-applies
                  at load) so a no-emitter room never persists a 0-output rad. */}
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  Emitter Type
                </label>
                <select
                  value={room.emitter_type || ''}
                  onChange={(e) => {
                    const val = e.target.value as 'radiator' | 'ufh' | 'fan_coil' | 'none'
                    const changes: Partial<RoomConfigYaml> = { emitter_type: val }
                    if (val === 'none') {
                      changes.emitter_kw = 0
                    } else if (room.emitter_type === 'none') {
                      changes.emitter_kw = undefined
                    }
                    updateRoom(name, changes)
                  }}
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                >
                  <option value="" disabled>
                    Select emitter type…
                  </option>
                  <option value="radiator">Radiator</option>
                  <option value="ufh">Underfloor Heating</option>
                  <option value="fan_coil">Fan Coil</option>
                  <option value="none">None (no emitter)</option>
                </select>
              </div>
            </div>
            {/* Control mode — driver-agnostic */}
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  Control Mode
                </label>
                <select
                  value={room.control_mode || 'indirect'}
                  onChange={(e) => {
                    const mode = e.target.value as 'indirect' | 'direct' | 'none'
                    const changes: Partial<RoomConfigYaml> = { control_mode: mode }
                    if (mode !== 'direct') {
                      changes.valve_hardware = undefined
                      changes.valve_scale = undefined
                      changes.trv_name = undefined
                    } else {
                      changes.valve_hardware = room.valve_hardware || 'generic'
                    }
                    updateRoom(name, changes)
                  }}
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                >
                  <option value="indirect">Indirect (TRV setpoint)</option>
                  <option value="direct">Direct (valve control)</option>
                  <option value="none">None</option>
                </select>
              </div>
              {room.control_mode === 'direct' && driver !== 'mqtt' && (
                <>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">
                      Valve Hardware
                    </label>
                    <select
                      value={room.valve_hardware || 'generic'}
                      onChange={(e) => {
                        const hw = e.target.value as RoomConfigYaml['valve_hardware']
                        const changes: Partial<RoomConfigYaml> = { valve_hardware: hw }
                        if (hw !== 'direct_type1') changes.valve_scale = undefined
                        updateRoom(name, changes)
                      }}
                      className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                    >
                      <option value="direct_type1">Direct Type 1</option>
                      <option value="direct_type2">Direct Type 2</option>
                      <option value="generic">Generic</option>
                    </select>
                  </div>
                  {!isMultiEmitter(room.trv_entity) && (
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">
                        TRV Name
                      </label>
                      <input
                        type="text"
                        value={room.trv_name ?? ''}
                        onChange={(e) => updateRoom(name, { trv_name: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                      />
                    </div>
                  )}
                  {room.valve_hardware === 'direct_type1' && (
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">
                        Valve Range
                      </label>
                      <select
                        value={room.valve_scale ?? 255}
                        onChange={(e) =>
                          updateRoom(name, { valve_scale: parseInt(e.target.value, 10) })
                        }
                        className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                      >
                        <option value={255}>0–255</option>
                        <option value={100}>0–100%</option>
                      </select>
                    </div>
                  )}
                </>
              )}
              {room.control_mode === 'none' && (
                <div data-testid={`fixed-setpoint-${name}`}>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Fixed Setpoint (°C)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={25}
                    step={0.5}
                    value={room.fixed_setpoint ?? ''}
                    placeholder="Uses global comfort"
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '') {
                        updateRoom(name, { fixed_setpoint: undefined })
                        return
                      }
                      const val = parseFloat(raw)
                      if (isNaN(val) || val < 10 || val > 25) return
                      updateRoom(name, { fixed_setpoint: val })
                    }}
                    className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
                  />
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Use when the room has a manual TRV that caps below comfort temp.
                  </p>
                </div>
              )}
            </div>

            {/* Driver-branched entity/topic fields */}
            {driver === 'mqtt' ? (
              <div className="space-y-3">
                {!getTopicString(room.mqtt_topics?.room_temp) && (
                  <div
                    role="alert"
                    className="rounded-md border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs text-[var(--amber)]"
                  >
                    No Room Temp Topic set — this room will display &quot;--&quot; until a topic is
                    provided and a publisher sends a numeric value.
                  </div>
                )}
                <TopicField
                  label="Room Temp Topic"
                  value={getTopicString(room.mqtt_topics?.room_temp)}
                  onChange={(v) =>
                    updateRoom(name, {
                      mqtt_topics: {
                        ...room.mqtt_topics,
                        room_temp: setTopicString(room.mqtt_topics?.room_temp, v),
                      },
                    })
                  }
                  placeholder={`rooms/${name}/temp`}
                />
                {/* INSTRUCTION-224E — list-form valve_position editor for MQTT
                    multi-emitter zones. Mirrors the HA-side trv_entity editor.
                    Primary input + `+` adds slots; extra inputs each have a
                    remove button. Single-emitter operators see one input + `+`. */}
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    {isMultiPositionTopic(room) ? 'Valve Position Topics' : 'Valve Position Topic'}
                  </label>
                  <div className="space-y-1.5">
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <TopicField
                          label=""
                          value={getPrimaryValvePositionTopic(room)}
                          onChange={(v) => updateValvePositionAt(name, 0, v)}
                          placeholder={`rooms/${name}/valve`}
                        />
                      </div>
                      <button
                        onClick={() => addValvePositionSlot(name)}
                        className="mb-0.5 px-2 py-1.5 rounded border border-[var(--border)] text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                        title="Add additional valve position topic (multi-emitter)"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    {getExtraValvePositionTopics(room).map((topic, i) => (
                      <div key={`vp-${i + 1}`} className="flex items-end gap-2">
                        <div className="flex-1">
                          <TopicField
                            label={`Valve Position Topic ${i + 2}`}
                            value={topic}
                            onChange={(v) => updateValvePositionAt(name, i + 1, v)}
                            placeholder={`rooms/${name}/valve/emitter${i + 2}`}
                          />
                        </div>
                        <button
                          onClick={() => removeValvePositionAt(name, i + 1)}
                          className="mb-0.5 px-2 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-[var(--red)]"
                          title="Remove this topic"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <TopicField
                  label="Valve Setpoint Topic"
                  value={room.mqtt_topics?.valve_setpoint || ''}
                  onChange={(v) =>
                    updateRoom(name, {
                      mqtt_topics: {
                        ...room.mqtt_topics,
                        valve_setpoint: v || undefined,
                      },
                    })
                  }
                  placeholder={`rooms/${name}/valve/set`}
                />
                <TopicField
                  label="TRV Setpoint Topic"
                  value={room.mqtt_topics?.trv_setpoint || ''}
                  onChange={(v) =>
                    updateRoom(name, {
                      mqtt_topics: {
                        ...room.mqtt_topics,
                        trv_setpoint: v || undefined,
                      },
                    })
                  }
                  placeholder={`rooms/${name}/setpoint`}
                />
                <TopicField
                  label="Occupancy Topic"
                  value={room.mqtt_topics?.occupancy_sensor || ''}
                  onChange={(v) =>
                    updateRoom(name, {
                      mqtt_topics: {
                        ...room.mqtt_topics,
                        occupancy_sensor: v || undefined,
                      },
                    })
                  }
                  placeholder={`rooms/${name}/occupancy`}
                />

                {/* Occupancy debounce — driver-agnostic */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">
                      Debounce (s)
                    </label>
                    <input
                      type="number"
                      step="10"
                      min="0"
                      max="600"
                      value={room.occupancy_debounce ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value ? parseInt(e.target.value, 10) : undefined
                        const clamped = raw !== undefined ? Math.min(600, Math.max(0, raw)) : undefined
                        updateRoom(name, { occupancy_debounce: clamped })
                      }}
                      placeholder="60"
                      className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
                    />
                  </div>
                </div>

                {/* Legacy HA config — render read-only muted if present */}
                {hasLegacyHaFields(room) && (
                  <div className="mt-4 pt-3 border-t border-[var(--border)] space-y-2">
                    <h4 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                      Legacy HA config — not active on MQTT driver
                    </h4>
                    {room.trv_entity && (
                      <p className="text-xs text-[var(--text-muted)]">
                        TRV Entity: {Array.isArray(room.trv_entity) ? room.trv_entity.join(', ') : room.trv_entity}
                      </p>
                    )}
                    {room.independent_sensor && (
                      <p className="text-xs text-[var(--text-muted)]">
                        Temp Sensor: {room.independent_sensor}
                      </p>
                    )}
                    {room.heating_entity && (
                      <p className="text-xs text-[var(--text-muted)]">
                        Heating Entity: {room.heating_entity}
                      </p>
                    )}
                    {room.occupancy_sensor && (
                      <p className="text-xs text-[var(--text-muted)]">
                        Occupancy Sensor: {room.occupancy_sensor}
                      </p>
                    )}
                    <button
                      onClick={() => clearLegacyHaFields(name)}
                      className="text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--red)] hover:border-[var(--red)] transition-colors"
                    >
                      Clear legacy HA fields
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {/* INSTRUCTION-231D — paired per-emitter rows. rowCount =
                    max(trvLen, heLen, 1); each row pairs a TRV input with a
                    Heating input and a remove button (when rowCount > 1).
                    The "Add emitter" button extends both lists simultaneously. */}
                {(() => {
                  const trv = room.trv_entity
                  const he = room.heating_entity
                  const trvLen = !trv ? 0 : Array.isArray(trv) ? trv.length : 1
                  const heLen = !he ? 0 : Array.isArray(he) ? he.length : 1
                  const rowCount = Math.max(trvLen, heLen, 1)
                  return Array.from({ length: rowCount }, (_, i) => {
                    const trvValue =
                      i === 0 ? getPrimaryTrv(room) : getExtraTrvs(room)[i - 1] || ''
                    const heValue =
                      i === 0
                        ? getPrimaryHeating(room)
                        : getExtraHeatings(room)[i - 1] || ''
                    const trvLabel = i === 0 ? 'TRV Entity' : `TRV Entity ${i + 1}`
                    const heLabel =
                      i === 0 ? 'Heating Entity' : `Heating Entity ${i + 1}`
                    return (
                      <div
                        key={`emitter-row-${i}`}
                        className="flex items-end gap-2"
                      >
                        <div className="flex-1 grid grid-cols-2 gap-3">
                          <EntityField
                            label={trvLabel}
                            value={trvValue}
                            friendlyName={resolved[trvValue]?.friendly_name}
                            state={resolved[trvValue]?.state}
                            unit={resolved[trvValue]?.unit}
                            placeholder="climate.room_trv"
                            onChange={(v) => updateTrvAt(name, i, v)}
                          />
                          <EntityField
                            label={heLabel}
                            value={heValue}
                            friendlyName={resolved[heValue]?.friendly_name}
                            state={resolved[heValue]?.state}
                            unit={resolved[heValue]?.unit}
                            placeholder="sensor.<room>_heating or number.<room>_valve_position"
                            onChange={(v) => updateHeatingAt(name, i, v)}
                          />
                        </div>
                        {rowCount > 1 && (
                          <button
                            onClick={() => removeEmitterSlot(name, i)}
                            className="mb-0.5 px-2 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-[var(--red)]"
                            title={`Remove emitter ${i + 1}`}
                            aria-label={`Remove emitter ${i + 1}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )
                  })
                })()}
                <button
                  onClick={() => {
                    addTrvSlot(name)
                    addHeatingSlot(name)
                  }}
                  className="flex items-center gap-1 px-2 py-1.5 rounded border border-[var(--border)] text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                  title="Add emitter"
                  aria-label="Add emitter"
                >
                  <Plus size={14} /> Add emitter
                </button>
                <div className="grid grid-cols-2 gap-3">
                  <EntityField
                    label="Temp Sensor"
                    value={room.independent_sensor || ''}
                    friendlyName={resolved[room.independent_sensor || '']?.friendly_name}
                    state={resolved[room.independent_sensor || '']?.state}
                    unit={resolved[room.independent_sensor || '']?.unit}
                    placeholder="sensor.room_temp"
                    onChange={(v) => updateRoom(name, { independent_sensor: v || undefined })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <EntityField
                    label="Occupancy Sensor"
                    value={room.occupancy_sensor || ''}
                    friendlyName={resolved[room.occupancy_sensor || '']?.friendly_name}
                    state={resolved[room.occupancy_sensor || '']?.state}
                    unit={resolved[room.occupancy_sensor || '']?.unit}
                    placeholder="binary_sensor.room_presence"
                    onChange={(v) => updateRoom(name, { occupancy_sensor: v || undefined })}
                  />
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">
                      Debounce (s)
                    </label>
                    <input
                      type="number"
                      step="10"
                      min="0"
                      max="600"
                      value={room.occupancy_debounce ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value ? parseInt(e.target.value, 10) : undefined
                        const clamped = raw !== undefined ? Math.min(600, Math.max(0, raw)) : undefined
                        updateRoom(name, { occupancy_debounce: clamped })
                      }}
                      placeholder="60"
                      className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
                    />
                  </div>
                </div>
                {room.occupancy_sensor && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">
                        Sensor Unavailable Behaviour
                      </label>
                      <select
                        value={room.occupancy_fallback || 'schedule'}
                        onChange={(e) =>
                          updateRoom(name, {
                            occupancy_fallback: e.target.value as RoomConfigYaml['occupancy_fallback'],
                          })
                        }
                        className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                      >
                        <option value="schedule">Use Schedule</option>
                        <option value="occupied">Assume Occupied</option>
                        <option value="last_known">Hold Last Known</option>
                      </select>
                    </div>
                    {room.occupancy_fallback === 'last_known' && (
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">
                          Watchdog timeout (min)
                        </label>
                        <input
                          type="number"
                          step="5"
                          min="5"
                          max="480"
                          value={room.last_known_timeout_s != null ? Math.round(room.last_known_timeout_s / 60) : ''}
                          onChange={(e) => {
                            const mins = e.target.value ? parseInt(e.target.value, 10) : undefined
                            updateRoom(name, {
                              last_known_timeout_s: mins !== undefined ? Math.min(28800, Math.max(300, mins * 60)) : undefined,
                            })
                          }}
                          placeholder="60"
                          className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
                        />
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          Degrade to &lsquo;occupied&rsquo; after this duration if sensor doesn&apos;t recover
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* INSTRUCTION-162A: Per-room auxiliary boolean output editor.
                Driver-aware (HA entity vs MQTT topic). Toggling off sets
                auxiliary_output to null which strips the YAML key on save. */}
            <div className="pt-3 border-t border-[var(--border)] space-y-2">
              <div>
                <h4 className="text-sm font-medium text-[var(--text)]">
                  Auxiliary output
                </h4>
                <p className="text-xs text-[var(--text-muted)]">
                  Per-room boolean output for direct electric heaters, panel heaters, etc.
                </p>
              </div>
              <AuxOutputEditor
                value={room.auxiliary_output}
                onChange={(next: AuxiliaryOutputYaml | null) =>
                  updateRoom(name, { auxiliary_output: next })
                }
                onValidityChange={(valid) =>
                  setAuxValidByRoom((prev) =>
                    prev[name] === valid ? prev : { ...prev, [name]: valid }
                  )
                }
                driver={driver}
                controlMode={room.control_mode}
                resolved={resolved}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
