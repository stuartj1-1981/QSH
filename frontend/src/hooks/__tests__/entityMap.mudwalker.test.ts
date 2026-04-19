import { describe, it, expect } from 'vitest'
import { buildEntityMap } from '../entityMap'

describe('buildEntityMap — MQTT install (Mudwalker)', () => {
  it('resolves temp_sensor from mqtt_topics.room_temp (string form)', () => {
    const config = {
      entities: {},
      rooms: {
        cloaks: {
          mqtt_topics: { room_temp: 'temps/roomCloaks' },
        },
      },
      zone_sensor_map: {},
    }
    const map = buildEntityMap(config)!
    expect(map.rooms.cloaks.temp_sensor).toBe('temps/roomCloaks')
  })

  it('resolves temp_sensor from mqtt_topics.room_temp ({topic: ...} object form)', () => {
    const config = {
      entities: {},
      rooms: {
        bedroom_1: {
          mqtt_topics: {
            room_temp: { topic: 'temps/roomBedroom1', format: 'plain' },
          },
        },
      },
      zone_sensor_map: {},
    }
    const map = buildEntityMap(config)!
    expect(map.rooms.bedroom_1.temp_sensor).toBe('temps/roomBedroom1')
  })

  it('resolves temp_sensor from the first element when mqtt_topics.room_temp is a list', () => {
    const config = {
      entities: {},
      rooms: {
        living_room: {
          mqtt_topics: {
            // Multi-source: primary temperature topic + a zigbee backup.
            room_temp: ['temps/roomLiving', 'zigbee2mqtt/USonic_LR'],
          },
        },
      },
      zone_sensor_map: {},
    }
    const map = buildEntityMap(config)!
    expect(map.rooms.living_room.temp_sensor).toBe('temps/roomLiving')
  })

  it('independent_sensor takes precedence over mqtt_topics.room_temp', () => {
    const config = {
      entities: {},
      rooms: {
        study: {
          independent_sensor: 'sensor.study_bench',
          mqtt_topics: { room_temp: 'temps/roomStudy' },
        },
      },
      zone_sensor_map: {},
    }
    const map = buildEntityMap(config)!
    expect(map.rooms.study.temp_sensor).toBe('sensor.study_bench')
  })

  it('resolves occupancy_sensor from mqtt_topics when no top-level occupancy_sensor set', () => {
    const config = {
      entities: {},
      rooms: {
        hall: {
          mqtt_topics: { occupancy_sensor: 'zigbee2mqtt/hall_pir' },
        },
      },
      zone_sensor_map: {},
    }
    const map = buildEntityMap(config)!
    expect(map.rooms.hall.occupancy_sensor).toBe('zigbee2mqtt/hall_pir')
    // No temp source at all: temp_sensor stays undefined.
    expect(map.rooms.hall.temp_sensor).toBeUndefined()
  })

  it('top-level occupancy_sensor wins over mqtt_topics.occupancy_sensor', () => {
    const config = {
      entities: {},
      rooms: {
        hall: {
          occupancy_sensor: 'binary_sensor.hall_motion',
          mqtt_topics: { occupancy_sensor: 'zigbee2mqtt/hall_pir' },
        },
      },
      zone_sensor_map: {},
    }
    const map = buildEntityMap(config)!
    expect(map.rooms.hall.occupancy_sensor).toBe('binary_sensor.hall_motion')
  })

  it('room with no temp sources at all is omitted from map.rooms', () => {
    const config = {
      entities: {},
      rooms: {
        hall: {},
      },
      zone_sensor_map: {},
    }
    const map = buildEntityMap(config)!
    expect(map.rooms.hall).toBeUndefined()
  })
})
