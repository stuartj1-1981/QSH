import { useState, useMemo, useCallback } from 'react'
import { Plus, Trash2, Save, Loader2 } from 'lucide-react'
import { usePatchConfig } from '../../hooks/useConfig'
import { useEntityResolve } from '../../hooks/useEntityResolve'
import { FACING_OPTIONS, type RoomConfigYaml, type RoomMqttTopicValue, type Driver } from '../../types/config'
import { EntityField } from './EntityField'
import { TopicField } from './TopicField'

interface RoomSettingsProps {
  rooms: Record<string, RoomConfigYaml>
  driver: Driver
  onRefetch: () => void
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

export function RoomSettings({ rooms, driver, onRefetch }: RoomSettingsProps) {
  const [editedRooms, setEditedRooms] = useState<Record<string, RoomConfigYaml>>(rooms)
  const [newName, setNewName] = useState('')
  const { patch, saving } = usePatchConfig()

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

  const save = async () => {
    const result = await patch('rooms', editedRooms)
    if (result) onRefetch()
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
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
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
                  onChange={(e) =>
                    updateRoom(name, {
                      emitter_kw: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  placeholder="Auto"
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
                />
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
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1">
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
            </div>

            {/* Driver-branched entity/topic fields */}
            {driver === 'mqtt' ? (
              <div className="space-y-3">
                <TopicField
                  label="Room Temp Topic"
                  value={getTopicString(room.mqtt_topics?.room_temp)}
                  onChange={(v) =>
                    updateRoom(name, {
                      mqtt_topics: {
                        ...room.mqtt_topics,
                        room_temp: setTopicString(room.mqtt_topics?.room_temp, v) ?? '',
                      },
                    })
                  }
                  placeholder={`rooms/${name}/temp`}
                />
                <TopicField
                  label="Valve Position Topic"
                  value={getTopicString(room.mqtt_topics?.valve_position)}
                  onChange={(v) =>
                    updateRoom(name, {
                      mqtt_topics: {
                        ...room.mqtt_topics,
                        room_temp: room.mqtt_topics?.room_temp ?? '',
                        valve_position: setTopicString(room.mqtt_topics?.valve_position, v),
                      },
                    })
                  }
                  placeholder={`rooms/${name}/valve`}
                />
                <TopicField
                  label="Valve Setpoint Topic"
                  value={room.mqtt_topics?.valve_setpoint || ''}
                  onChange={(v) =>
                    updateRoom(name, {
                      mqtt_topics: {
                        ...room.mqtt_topics,
                        room_temp: room.mqtt_topics?.room_temp ?? '',
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
                        room_temp: room.mqtt_topics?.room_temp ?? '',
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
                        room_temp: room.mqtt_topics?.room_temp ?? '',
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
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <EntityField
                      label="TRV Entity"
                      value={getPrimaryTrv(room)}
                      friendlyName={resolved[getPrimaryTrv(room)]?.friendly_name}
                      state={resolved[getPrimaryTrv(room)]?.state}
                      unit={resolved[getPrimaryTrv(room)]?.unit}
                      placeholder="climate.room_trv"
                      onChange={(v) => updateTrvAt(name, 0, v)}
                    />
                  </div>
                  <button
                    onClick={() => addTrvSlot(name)}
                    className="mb-0.5 px-2 py-1.5 rounded border border-[var(--border)] text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                    title="Add additional TRV"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {getExtraTrvs(room).map((trv, i) => (
                  <div key={`trv-${i + 1}`} className="flex items-end gap-2">
                    <div className="flex-1">
                      <EntityField
                        label={`TRV Entity ${i + 2}`}
                        value={trv}
                        friendlyName={resolved[trv]?.friendly_name}
                        state={resolved[trv]?.state}
                        unit={resolved[trv]?.unit}
                        placeholder="climate.room_trv"
                        onChange={(v) => updateTrvAt(name, i + 1, v)}
                      />
                    </div>
                    <button
                      onClick={() => updateTrvAt(name, i + 1, '')}
                      className="mb-0.5 px-2 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-[var(--red)]"
                      title="Remove this TRV"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
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
                  <EntityField
                    label="Heating Entity"
                    value={room.heating_entity || ''}
                    friendlyName={resolved[room.heating_entity || '']?.friendly_name}
                    state={resolved[room.heating_entity || '']?.state}
                    unit={resolved[room.heating_entity || '']?.unit}
                    placeholder="binary_sensor.heating"
                    onChange={(v) => updateRoom(name, { heating_entity: v || undefined })}
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
          </div>
        ))}
      </div>
    </div>
  )
}
