export interface EntityMap {
  // System-level entities
  outdoor_temp?: string
  hp_power?: string
  hp_cop?: string
  hp_flow_temp?: string
  hp_return_temp?: string
  hp_flow_rate?: string
  flow_min?: string
  flow_max?: string
  solar_production?: string
  battery_soc?: string
  // Per-room entities (keyed by room name)
  rooms: Record<string, {
    temp_sensor?: string
    trv_entity?: string
    occupancy_sensor?: string
  }>
}

/** Extract a single topic string from the various RoomMqttTopicValue shapes:
 *  plain string, first element of an array, or `{ topic: ... }` object. */
function firstTopic(v: unknown): string | undefined {
  if (typeof v === 'string' && v) return v
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') return v[0]
  if (v && typeof v === 'object') {
    const t = (v as { topic?: unknown }).topic
    if (typeof t === 'string' && t) return t
  }
  return undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildEntityMap(config: Record<string, any> | null): EntityMap | null {
  if (!config) return null

  const entities: Record<string, string> = config.entities ?? {}
  const rooms: Record<string, Record<string, unknown>> = config.rooms ?? {}
  const zoneSensorMap: Record<string, string> = config.zone_sensor_map ?? {}

  const map: EntityMap = { rooms: {} }

  // System-level: direct key matches
  if (entities.outdoor_temp) map.outdoor_temp = entities.outdoor_temp
  if (entities.hp_energy_rate) map.hp_power = entities.hp_energy_rate
  if (entities.hp_cop) map.hp_cop = entities.hp_cop
  if (entities.hp_flow_temp) map.hp_flow_temp = entities.hp_flow_temp
  if (entities.hp_return_temp) map.hp_return_temp = entities.hp_return_temp
  if (entities.hp_flow_rate) map.hp_flow_rate = entities.hp_flow_rate
  if (entities.flow_min_temp) map.flow_min = entities.flow_min_temp
  if (entities.flow_max_temp) map.flow_max = entities.flow_max_temp
  if (entities.solar_production) map.solar_production = entities.solar_production
  if (entities.battery_soc) map.battery_soc = entities.battery_soc

  // Per-room entities
  for (const [roomName, roomConfig] of Object.entries(rooms)) {
    const roomEntities: EntityMap['rooms'][string] = {}

    const mqttTopics = (roomConfig.mqtt_topics ?? {}) as Record<string, unknown>
    const mqttRoomTemp = firstTopic(mqttTopics.room_temp)
    const mqttOccupancy = firstTopic(mqttTopics.occupancy_sensor)

    // temp_sensor: zone_sensor_map → independent_sensor → mqtt_topics.room_temp → trv_entity
    const sensorKey = zoneSensorMap[roomName]
    if (sensorKey && entities[sensorKey]) {
      roomEntities.temp_sensor = entities[sensorKey]
    } else if (typeof roomConfig.independent_sensor === 'string') {
      roomEntities.temp_sensor = roomConfig.independent_sensor
    } else if (mqttRoomTemp) {
      roomEntities.temp_sensor = mqttRoomTemp
    } else {
      // Fall back to trv_entity
      const trv = roomConfig.trv_entity
      if (Array.isArray(trv) && trv.length > 0) {
        roomEntities.temp_sensor = trv[0]
      } else if (typeof trv === 'string') {
        roomEntities.temp_sensor = trv
      }
    }

    // trv_entity: direct, first element if array
    const trv = roomConfig.trv_entity
    if (Array.isArray(trv) && trv.length > 0) {
      roomEntities.trv_entity = trv[0]
    } else if (typeof trv === 'string') {
      roomEntities.trv_entity = trv
    }

    // occupancy_sensor: top-level first, then mqtt_topics.occupancy_sensor
    if (typeof roomConfig.occupancy_sensor === 'string') {
      roomEntities.occupancy_sensor = roomConfig.occupancy_sensor
    } else if (mqttOccupancy) {
      roomEntities.occupancy_sensor = mqttOccupancy
    }

    if (Object.keys(roomEntities).length > 0) {
      map.rooms[roomName] = roomEntities
    }
  }

  return map
}
