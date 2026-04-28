import { useState } from 'react'
import { Plus, Trash2, Search, Loader2 } from 'lucide-react'
import { EntityPicker } from './EntityPicker'
import { TopicPicker } from './TopicPicker'
import { TopicDiscoveryPanel } from './TopicDiscoveryPanel'
import { useRoomEntityScan } from '../../hooks/useEntityScan'
import { FACING_OPTIONS, type RoomConfigYaml, type RoomMqttTopicValue, type MqttConfig, type MqttTopicCandidate, type QshConfigYaml } from '../../types/config'

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

  const addRoom = () => {
    const name = newName.trim().toLowerCase().replace(/\s+/g, '_')
    if (!name || rooms[name]) return
    const newRooms = {
      ...rooms,
      [name]: { area_m2: 15, facing: 'interior', ceiling_m: 2.4 },
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

  /** Add an additional TRV slot. */
  const addTrvSlot = (roomName: string) => {
    const room = rooms[roomName]
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
  }

  /** Extract the topic string from a RoomMqttTopicValue (string or object). */
  const getRoomTopicStr = (val: RoomMqttTopicValue | undefined): string =>
    !val ? '' : typeof val === 'string' ? val : val.topic || ''
  const getRoomTopicFormat = (val: RoomMqttTopicValue | undefined): 'plain' | 'json' | undefined =>
    val && typeof val === 'object' ? val.format : undefined
  const getRoomTopicJsonPath = (val: RoomMqttTopicValue | undefined): string | undefined =>
    val && typeof val === 'object' ? val.json_path : undefined

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
          const extraTrvs = getExtraTrvs(room)

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

                  {/* Emitter type */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text)] mb-1">
                      Emitter Type
                    </label>
                    <select
                      value={room.emitter_type || 'radiator'}
                      onChange={(e) => {
                        const val = e.target.value as 'radiator' | 'ufh' | 'fan_coil'
                        updateRoom(name, { emitter_type: val })
                      }}
                      className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                    >
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

                      {/* Entity pickers */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <EntityPicker
                              slot="trv_entity"
                              room={name}
                              label={room.control_mode === 'direct' ? 'Valve Position Entity' : 'TRV Entity'}
                              value={getPrimaryTrv(room)}
                              onChange={(v) => updateTrvAt(name, 0, v)}
                              candidates={candidates.trv_entity || []}
                              required
                            />
                          </div>
                          <button
                            onClick={() => addTrvSlot(name)}
                            className="mt-5 px-2 py-1.5 rounded border border-[var(--border)] text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                            title="Add additional TRV"
                          >
                            <Plus size={14} />
                          </button>
                        </div>

                        {/* Extra TRV slots */}
                        {extraTrvs.map((trv, i) => (
                          <EntityPicker
                            key={`trv-${i + 1}`}
                            slot="trv_entity"
                            room={name}
                            label={`TRV Entity ${i + 2}`}
                            value={trv}
                            onChange={(v) => updateTrvAt(name, i + 1, v)}
                            candidates={candidates.trv_entity || []}
                          />
                        ))}
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
                        slot="heating_entity"
                        room={name}
                        label="Heating Feedback Entity"
                        value={room.heating_entity || ''}
                        onChange={(v) =>
                          updateRoom(name, { heating_entity: v || undefined })
                        }
                        candidates={candidates.heating_entity || []}
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
