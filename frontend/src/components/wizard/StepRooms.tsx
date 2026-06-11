import { useState } from 'react'
import { Plus, Trash2, Search, Loader2 } from 'lucide-react'
import { EntityPicker } from './EntityPicker'
import { TopicPicker } from './TopicPicker'
import { TopicDiscoveryPanel } from './TopicDiscoveryPanel'
import { useRoomEntityScan } from '../../hooks/useEntityScan'
import { FACING_OPTIONS, type PropertyYaml, type RoomConfigYaml, type RoomMqttTopicValue, type MqttConfig, type MqttTopicCandidate, type QshConfigYaml } from '../../types/config'

/** Mirrors AREA_RECONCILIATION_TOLERANCE in qsh/api/routes/wizard.py — used
 *  only to colour the live readout; the backend rule is authoritative. */
const AREA_TOLERANCE = 0.25

interface StepRoomsProps {
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

export function StepRooms({ config, onUpdate }: StepRoomsProps) {
  const rooms = config.rooms ?? ({} as Record<string, RoomConfigYaml>)
  const [newName, setNewName] = useState('')
  const [editingRoom, setEditingRoom] = useState<string | null>(null)
  const {
    roomCandidates,
    loading: scanLoading,
    scanRoom,
    lastScanByRoom,
    loadingByRoom,
    errorByRoom,
  } = useRoomEntityScan()
  const isMqtt = config.driver === 'mqtt'
  const mqtt: MqttConfig = (config.mqtt as MqttConfig) || { broker: '', port: 1883, inputs: {} }
  const [mqttScanResults, setMqttScanResults] = useState<MqttTopicCandidate[]>([])

  // INSTRUCTION-324 — property ground truth, captured before the rooms.
  const property: PropertyYaml = (config.property as PropertyYaml) ?? {}
  const sumRoomArea = Object.values(rooms).reduce(
    (total, room) => total + (room.area_m2 || 0),
    0
  )
  const declaredArea = property.total_floor_area_m2
  const areaGapPct =
    declaredArea && declaredArea > 0
      ? Math.abs(sumRoomArea - declaredArea) / declaredArea
      : null

  const updateProperty = (changes: Partial<PropertyYaml>) => {
    onUpdate('property', { ...property, ...changes })
  }

  const addRoom = () => {
    const name = newName.trim().toLowerCase().replace(/\s+/g, '_')
    if (!name || rooms[name]) return
    const newRooms = {
      ...rooms,
      // emitter_type seeded explicitly (INSTRUCTION-324): the truth gate
      // requires it per room, and the select below displays exactly what
      // will be deployed — a visible default, never a silent one.
      [name]: { area_m2: 15, facing: 'interior', ceiling_m: 2.4, emitter_type: 'radiator' as const },
    }
    onUpdate('rooms', newRooms)
    setNewName('')
    setEditingRoom(name)
  }

  const updateRoom = (roomName: string, changes: Partial<RoomConfigYaml>) => {
    const updated = { ...rooms[roomName], ...changes }
    onUpdate('rooms', { ...rooms, [roomName]: updated })
  }

  const deleteRoom = (roomName: string) => {
    const rest = { ...rooms }
    delete rest[roomName]
    onUpdate('rooms', rest)
    if (editingRoom === roomName) setEditingRoom(null)
  }

  /** Get the primary TRV entity (first element if array). */
  const getPrimaryTrv = (room: RoomConfigYaml): string => {
    const trv = room.trv_entity
    if (!trv) return ''
    return Array.isArray(trv) ? trv[0] || '' : trv
  }

  /** Get additional TRV entities (2nd+ elements). */
  const getExtraTrvs = (room: RoomConfigYaml): string[] => {
    const trv = room.trv_entity
    if (!trv || !Array.isArray(trv)) return []
    return trv.slice(1)
  }

  /** Update TRV entity at a specific index. */
  const updateTrvAt = (roomName: string, index: number, value: string) => {
    const room = rooms[roomName]
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

    const changes: Partial<RoomConfigYaml> = { trv_entity: normalised }
    if (normalised) {
      changes.control_mode = room.control_mode || 'indirect'
    } else {
      changes.control_mode = 'none'
    }
    updateRoom(roomName, changes)
  }

  // INSTRUCTION-231D — heating_entity multi-emitter helpers. Mirror the
  // trv_entity helpers above with the V2 MEDIUM-1 unified pad-and-set
  // pattern. The wizard's updateTrvAt sets control_mode = 'indirect' on
  // first TRV addition; the heating helpers do NOT replicate this — a
  // heating entity declaration is informational and does not imply a
  // control-mode change.

  /** Get the primary heating entity (first element if array). */
  const getPrimaryHeating = (room: RoomConfigYaml): string => {
    const he = room.heating_entity
    if (!he) return ''
    return Array.isArray(he) ? he[0] || '' : he
  }

  /** Get additional heating entities (2nd+ elements). */
  const getExtraHeatings = (room: RoomConfigYaml): string[] => {
    const he = room.heating_entity
    if (!he || !Array.isArray(he)) return []
    return he.slice(1)
  }

  /** Update one heating_entity slot at the given index.
   *  V2 MEDIUM-1 fix: unified pad-and-set pattern handles scalar, array,
   *  and undefined input shapes uniformly. */
  const updateHeatingAt = (roomName: string, index: number, value: string) => {
    const room = rooms[roomName]
    const current = room.heating_entity
    let arr: string[]
    if (!current) arr = []
    else if (Array.isArray(current)) arr = [...current]
    else arr = [current]
    while (arr.length <= index) arr.push('')
    arr[index] = value
    while (arr.length > 0 && arr[arr.length - 1] === '') arr.pop()
    const normalised =
      arr.length === 0 ? undefined : arr.length === 1 ? arr[0] : arr
    updateRoom(roomName, { heating_entity: normalised })
  }

  /** Atomic paired add — single updateRoom call that extends both
   *  trv_entity and heating_entity lists. The wizard reads `rooms` from
   *  the parent prop; calling separate trv-add + heating-add back-to-back
   *  would each see the stale parent-prop state (parent component
   *  doesn't re-render synchronously between calls). Combining into a
   *  single updateRoom avoids the race entirely. */
  const addEmitterSlot = (roomName: string) => {
    const room = rooms[roomName]
    const trvCurrent = room.trv_entity
    const heCurrent = room.heating_entity
    const trvArr = !trvCurrent
      ? ['', '']
      : Array.isArray(trvCurrent)
        ? [...trvCurrent, '']
        : [trvCurrent, '']
    const heArr = !heCurrent
      ? ['', '']
      : Array.isArray(heCurrent)
        ? [...heCurrent, '']
        : [heCurrent, '']
    updateRoom(roomName, { trv_entity: trvArr, heating_entity: heArr })
  }

  /** Remove the emitter row at the given index (paired removal of both
   *  trv and heating slots simultaneously). */
  const removeEmitterSlot = (roomName: string, index: number) => {
    const room = rooms[roomName]
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
  }

  /** Extract the topic string from a RoomMqttTopicValue (string or object).
   *  INSTRUCTION-224E: also handle list-form valve_position (post-224C). The
   *  wizard surface is single-topic only; for list-form configs (declared via
   *  Settings or YAML) the wizard displays the first topic and lets the operator
   *  edit it. Multi-emitter editing flows through Settings. */
  const getRoomTopicStr = (val: RoomMqttTopicValue | string[] | undefined): string => {
    if (!val) return ''
    if (Array.isArray(val)) return val[0] ?? ''
    return typeof val === 'string' ? val : val.topic || ''
  }
  const getRoomTopicFormat = (val: RoomMqttTopicValue | string[] | undefined): 'plain' | 'json' | undefined => {
    if (!val || Array.isArray(val)) return undefined
    return typeof val === 'object' ? val.format : undefined
  }
  const getRoomTopicJsonPath = (val: RoomMqttTopicValue | string[] | undefined): string | undefined => {
    if (!val || Array.isArray(val)) return undefined
    return typeof val === 'object' ? val.json_path : undefined
  }

  const updateRoomMqttTopic = (roomName: string, key: string, value: string, format?: string, jsonPath?: string) => {
    const room = rooms[roomName]
    const topics = room.mqtt_topics || {}
    let topicValue: RoomMqttTopicValue | undefined
    if (value) {
      if (format === 'json') {
        topicValue = { topic: value, format: 'json', ...(jsonPath ? { json_path: jsonPath } : {}) }
      } else {
        topicValue = value
      }
    }
    updateRoom(roomName, { mqtt_topics: { ...topics, [key]: topicValue } })
  }

  const roomNames = Object.keys(rooms)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">Rooms</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Define your rooms and map TRV/sensor entities. QSH needs at least one room.
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          <span className="text-[var(--red)]">*</span> <span>Mandatory</span>
        </p>
      </div>

      {/* INSTRUCTION-324 — property ground truth: the building first, then
          its rooms. The declared total anchors the Σ-room-area
          reconciliation; deploy refuses configs that don't reconcile. */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-3">
        <div>
          <h3 className="text-sm font-medium text-[var(--text)]">Property</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Declare the building before its rooms — room areas are checked
            against the total at deploy.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text)] mb-1">
              Total Floor Area (m²) <span className="text-[var(--red)]">*</span>
            </label>
            <input
              type="number"
              step="1"
              min="30"
              max="1000"
              value={property.total_floor_area_m2 ?? ''}
              onChange={(e) =>
                updateProperty({
                  total_floor_area_m2: e.target.value
                    ? parseFloat(e.target.value)
                    : undefined,
                })
              }
              placeholder="e.g. 189"
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text)] mb-1">
              Bedrooms — optional
            </label>
            <input
              type="number"
              step="1"
              min="0"
              max="12"
              value={property.bedrooms ?? ''}
              onChange={(e) =>
                updateProperty({
                  bedrooms: e.target.value
                    ? parseInt(e.target.value, 10)
                    : undefined,
                })
              }
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
        </div>
        {declaredArea != null && declaredArea > 0 && (
          <p
            data-testid="area-reconciliation-readout"
            className={`text-xs ${
              areaGapPct !== null && areaGapPct > AREA_TOLERANCE
                ? 'text-[var(--red)]'
                : 'text-[var(--text-muted)]'
            }`}
          >
            Rooms add up to {Math.round(sumRoomArea * 10) / 10} m² of{' '}
            {declaredArea} m² declared
            {areaGapPct !== null && (
              <> ({Math.round(areaGapPct * 100)}% gap{areaGapPct > AREA_TOLERANCE ? ' — exceeds the 25% tolerance, deploy will refuse' : ''})</>
            )}
          </p>
        )}
      </div>

      {/* Add room */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Room name (e.g. living_room)"
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
          onKeyDown={(e) => e.key === 'Enter' && addRoom()}
        />
        <button
          onClick={addRoom}
          disabled={!newName.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Plus size={16} />
          Add Room
        </button>
      </div>

      {/* Room cards */}
      <div className="space-y-3">
        {roomNames.map((name) => {
          const room = rooms[name]
          const isEditing = editingRoom === name
          const candidates = roomCandidates[name] || {}
          const hasTrv = !!room.trv_entity

          return (
            <div
              key={name}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden"
            >
              {/* Room header */}
              <button
                onClick={() => setEditingRoom(isEditing ? null : name)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm text-[var(--text)]">
                    {name.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {room.area_m2}m² | {room.facing || 'interior'}
                  </span>
                  {hasTrv && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)]">
                      TRV
                    </span>
                  )}
                  {room.control_mode === 'direct' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--amber)]/10 text-[var(--amber)]">
                      Direct
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Trash2
                    size={14}
                    className="text-[var(--text-muted)] hover:text-[var(--red)]"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteRoom(name)
                    }}
                  />
                </div>
              </button>

              {/* Room details (expanded) */}
              {isEditing && (
                <div className="px-4 pb-4 pt-2 border-t border-[var(--border)] space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-[var(--text)] mb-1">
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
                      <label className="block text-xs font-medium text-[var(--text)] mb-1">
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
                      <label className="block text-xs font-medium text-[var(--text)] mb-1">
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
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--text)] mb-1">
                      Emitter Output (kW) — optional
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={room.emitter_kw ?? ''}
                      onChange={(e) =>
                        updateRoom(name, {
                          emitter_kw: e.target.value ? parseFloat(e.target.value) : undefined,
                        })
                      }
                      placeholder="Auto-estimated from area"
                      className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
                    />
                  </div>

                  {/* Emitter type — required (INSTRUCTION-324). A room
                      without the key shows the placeholder instead of a
                      phantom "Radiator" that was never in the config; the
                      deploy gate errors until a real selection is made. */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text)] mb-1">
                      Emitter Type <span className="text-[var(--red)]">*</span>
                    </label>
                    <select
                      value={room.emitter_type || ''}
                      onChange={(e) => {
                        const val = e.target.value as 'radiator' | 'ufh' | 'fan_coil'
                        updateRoom(name, { emitter_type: val })
                      }}
                      className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                    >
                      <option value="" disabled>
                        Select emitter type…
                      </option>
                      <option value="radiator">Radiator</option>
                      <option value="ufh">Underfloor Heating</option>
                      <option value="fan_coil">Fan Coil</option>
                    </select>
                  </div>

                  {/* Control mode */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text)] mb-1">
                      Control Mode
                    </label>
                    <select
                      value={room.control_mode || 'indirect'}
                      onChange={(e) => {
                        const mode = e.target.value as 'indirect' | 'direct' | 'none'
                        const changes: Partial<RoomConfigYaml> = { control_mode: mode }
                        if (mode !== 'direct') {
                          changes.valve_hardware = undefined
                          changes.trv_name = undefined
                        } else {
                          changes.valve_hardware = room.valve_hardware || 'generic'
                          changes.trv_name = room.trv_name || `${name}_trv`
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

                  {/* Direct mode fields */}
                  {room.control_mode === 'direct' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text)] mb-1">
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
                      <div>
                        <label className="block text-xs font-medium text-[var(--text)] mb-1">
                          TRV Name
                        </label>
                        <input
                          type="text"
                          value={room.trv_name || `${name}_trv`}
                          onChange={(e) => updateRoom(name, { trv_name: e.target.value })}
                          className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                        />
                      </div>
                      {room.valve_hardware === 'direct_type1' && (
                        <div>
                          <label className="block text-xs font-medium text-[var(--text)] mb-1">
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
                    </div>
                  )}

                  {/* MQTT topics or HA entity pickers */}
                  {isMqtt ? (
                    <div className="space-y-3">
                      <TopicDiscoveryPanel
                        mqtt={mqtt}
                        onResults={setMqttScanResults}
                      />
                      {!getRoomTopicStr(room.mqtt_topics?.room_temp) && (
                        <div
                          role="alert"
                          className="rounded-md border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs text-[var(--amber)]"
                        >
                          No Room Temp Topic set — this room will display &quot;--&quot; until a topic is
                          provided and a publisher sends a numeric value.
                        </div>
                      )}
                      <TopicPicker
                        label="Room Temperature"
                        value={getRoomTopicStr(room.mqtt_topics?.room_temp)}
                        format={getRoomTopicFormat(room.mqtt_topics?.room_temp)}
                        jsonPath={getRoomTopicJsonPath(room.mqtt_topics?.room_temp)}
                        onChange={(v, fmt, jp) => updateRoomMqttTopic(name, 'room_temp', v, fmt, jp)}
                        scanResults={mqttScanResults}
                        required
                      />
                      <TopicPicker
                        label="Valve Position (optional)"
                        value={getRoomTopicStr(room.mqtt_topics?.valve_position)}
                        format={getRoomTopicFormat(room.mqtt_topics?.valve_position)}
                        jsonPath={getRoomTopicJsonPath(room.mqtt_topics?.valve_position)}
                        onChange={(v, fmt, jp) => updateRoomMqttTopic(name, 'valve_position', v, fmt, jp)}
                        scanResults={mqttScanResults}
                      />
                      <TopicPicker
                        label="Valve Setpoint (optional)"
                        value={room.mqtt_topics?.valve_setpoint || ''}
                        onChange={(v) => updateRoomMqttTopic(name, 'valve_setpoint', v)}
                        scanResults={mqttScanResults}
                      />
                      <TopicPicker
                        label="TRV Setpoint (optional)"
                        value={room.mqtt_topics?.trv_setpoint || ''}
                        onChange={(v) => updateRoomMqttTopic(name, 'trv_setpoint', v)}
                        scanResults={mqttScanResults}
                      />
                      <TopicPicker
                        label="Occupancy Sensor (optional)"
                        value={room.mqtt_topics?.occupancy_sensor || ''}
                        onChange={(v) => updateRoomMqttTopic(name, 'occupancy_sensor', v)}
                        scanResults={mqttScanResults}
                      />
                    </div>
                  ) : (
                    <>
                      {/* Scan button */}
                      {(() => {
                        const roomCandidateCount = Object.values(
                          roomCandidates[name] ?? {},
                        ).reduce((n, arr) => n + arr.length, 0)
                        return (
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => scanRoom(name)}
                              disabled={scanLoading}
                              className="flex items-center gap-2 px-3 py-1.5 rounded border border-[var(--border)] text-xs font-medium text-[var(--text)] hover:bg-[var(--bg)] disabled:opacity-50"
                            >
                              {scanLoading ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Search size={12} />
                              )}
                              Scan for this room
                            </button>
                            {lastScanByRoom[name] && !loadingByRoom[name] && !errorByRoom[name] && (
                              <span className="text-xs text-[var(--green)]">
                                Scanned — {roomCandidateCount} candidate{roomCandidateCount === 1 ? '' : 's'} found
                              </span>
                            )}
                            {errorByRoom[name] && (
                              <span className="text-xs text-[var(--red)]">
                                {errorByRoom[name]}
                              </span>
                            )}
                          </div>
                        )
                      })()}

                      {/* INSTRUCTION-231D — paired per-emitter rows
                          (TRV + Heating) in declaration order. rowCount =
                          max(trvLen, heLen, 1); each row pairs a TRV
                          EntityPicker with a Heating EntityPicker plus a
                          remove button (only when rowCount > 1). */}
                      <div className="space-y-3">
                        {(() => {
                          const trv = room.trv_entity
                          const he = room.heating_entity
                          const trvLen = !trv ? 0 : Array.isArray(trv) ? trv.length : 1
                          const heLen = !he ? 0 : Array.isArray(he) ? he.length : 1
                          const rowCount = Math.max(trvLen, heLen, 1)
                          return Array.from({ length: rowCount }, (_, i) => {
                            const trvValue =
                              i === 0
                                ? getPrimaryTrv(room)
                                : getExtraTrvs(room)[i - 1] || ''
                            const heValue =
                              i === 0
                                ? getPrimaryHeating(room)
                                : getExtraHeatings(room)[i - 1] || ''
                            const trvLabel =
                              i === 0
                                ? room.control_mode === 'direct'
                                  ? 'Valve Position Entity'
                                  : 'TRV Entity'
                                : `TRV Entity ${i + 1}`
                            const heLabel =
                              i === 0
                                ? 'Heating Feedback Entity'
                                : `Heating Feedback Entity ${i + 1}`
                            return (
                              <div
                                key={`emitter-row-${i}`}
                                className="flex items-end gap-2"
                              >
                                <div className="flex-1 grid grid-cols-2 gap-3">
                                  <EntityPicker
                                    slot="trv_entity"
                                    room={name}
                                    label={trvLabel}
                                    value={trvValue}
                                    onChange={(v) => updateTrvAt(name, i, v)}
                                    candidates={candidates.trv_entity || []}
                                    required={i === 0}
                                  />
                                  <EntityPicker
                                    slot="heating_entity"
                                    room={name}
                                    label={heLabel}
                                    value={heValue}
                                    onChange={(v) => updateHeatingAt(name, i, v)}
                                    candidates={candidates.heating_entity || []}
                                    required={i === 0}
                                  />
                                </div>
                                {rowCount > 1 && (
                                  <button
                                    onClick={() => removeEmitterSlot(name, i)}
                                    className="mt-5 px-2 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-[var(--red)]"
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
                          onClick={() => addEmitterSlot(name)}
                          className="flex items-center gap-1 px-2 py-1.5 rounded border border-[var(--border)] text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                          title="Add emitter"
                          aria-label="Add emitter"
                        >
                          <Plus size={14} /> Add emitter
                        </button>
                      </div>

                      <EntityPicker
                        slot="independent_sensor"
                        room={name}
                        label="Independent Temperature Sensor"
                        value={room.independent_sensor || ''}
                        onChange={(v) =>
                          updateRoom(name, { independent_sensor: v || undefined })
                        }
                        candidates={candidates.independent_sensor || []}
                        required
                      />
                      <EntityPicker
                        slot="occupancy_sensor"
                        room={name}
                        label="Occupancy Sensor (optional)"
                        value={room.occupancy_sensor || ''}
                        onChange={(v) =>
                          updateRoom(name, { occupancy_sensor: v || undefined })
                        }
                        candidates={candidates.occupancy_sensor || []}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {roomNames.length === 0 && (
        <div className="text-center py-8 text-sm text-[var(--text-muted)]">
          No rooms defined yet. Add your first room above.
        </div>
      )}
    </div>
  )
}
