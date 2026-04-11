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

    // temp_sensor: two-step lookup via zone_sensor_map
    const sensorKey = zoneSensorMap[roomName]
    if (sensorKey && entities[sensorKey]) {
      roomEntities.temp_sensor = entities[sensorKey]
    } else if (typeof roomConfig.independent_sensor === 'string') {
      roomEntities.temp_sensor = roomConfig.independent_sensor
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

    // occupancy_sensor: direct
    if (typeof roomConfig.occupancy_sensor === 'string') {
      roomEntities.occupancy_sensor = roomConfig.occupancy_sensor
    }

    if (Object.keys(roomEntities).length > 0) {
      map.rooms[roomName] = roomEntities
    }
  }

  return map
}
