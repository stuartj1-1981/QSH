import { describe, it, expect } from 'vitest'
import { buildEntityMap } from '../entityMap'

describe('buildEntityMap', () => {
  it('returns null for null config', () => {
    expect(buildEntityMap(null)).toBeNull()
  })

  it('maps system-level entities with correct key translations', () => {
    const config = {
      entities: {
        outdoor_temp: 'sensor.outdoor_temperature',
        hp_energy_rate: 'sensor.hp_power_input',
        hp_cop: 'sensor.hp_cop',
        hp_flow_temp: 'sensor.hp_flow_temperature',
        hp_return_temp: 'sensor.hp_return_temperature',
        hp_flow_rate: 'sensor.hp_flow_rate',
        flow_min_temp: 'input_number.flow_min_temperature',
        flow_max_temp: 'input_number.flow_max_temperature',
        solar_production: 'sensor.solar_power',
        battery_soc: 'sensor.battery_soc',
      },
      rooms: {},
    }
    const map = buildEntityMap(config)!
    expect(map.outdoor_temp).toBe('sensor.outdoor_temperature')
    expect(map.hp_power).toBe('sensor.hp_power_input')
    expect(map.hp_cop).toBe('sensor.hp_cop')
    expect(map.hp_flow_temp).toBe('sensor.hp_flow_temperature')
    expect(map.hp_return_temp).toBe('sensor.hp_return_temperature')
    expect(map.hp_flow_rate).toBe('sensor.hp_flow_rate')
    expect(map.flow_min).toBe('input_number.flow_min_temperature')
    expect(map.flow_max).toBe('input_number.flow_max_temperature')
    expect(map.solar_production).toBe('sensor.solar_power')
    expect(map.battery_soc).toBe('sensor.battery_soc')
  })

  it('resolves room temp_sensor via zone_sensor_map two-step lookup', () => {
    const config = {
      entities: {
        independent_sensor01: 'sensor.lounge_temperature',
      },
      rooms: {
        lounge: {
          trv_entity: 'climate.lounge_trv',
          occupancy_sensor: 'binary_sensor.lounge_pir',
        },
      },
      zone_sensor_map: {
        lounge: 'independent_sensor01',
      },
    }
    const map = buildEntityMap(config)!
    expect(map.rooms.lounge.temp_sensor).toBe('sensor.lounge_temperature')
    expect(map.rooms.lounge.trv_entity).toBe('climate.lounge_trv')
    expect(map.rooms.lounge.occupancy_sensor).toBe('binary_sensor.lounge_pir')
  })

  it('falls back to trv_entity when zone_sensor_map has no entry', () => {
    const config = {
      entities: {},
      rooms: {
        bedroom: {
          trv_entity: 'climate.bedroom_trv',
        },
      },
      zone_sensor_map: {},
    }
    const map = buildEntityMap(config)!
    expect(map.rooms.bedroom.temp_sensor).toBe('climate.bedroom_trv')
    expect(map.rooms.bedroom.trv_entity).toBe('climate.bedroom_trv')
  })

  it('handles trv_entity as string array (uses first element)', () => {
    const config = {
      entities: {},
      rooms: {
        kitchen: {
          trv_entity: ['climate.kitchen_trv1', 'climate.kitchen_trv2'],
        },
      },
      zone_sensor_map: {},
    }
    const map = buildEntityMap(config)!
    expect(map.rooms.kitchen.trv_entity).toBe('climate.kitchen_trv1')
    expect(map.rooms.kitchen.temp_sensor).toBe('climate.kitchen_trv1')
  })

  it('handles missing rooms and entities gracefully', () => {
    const config = {
      entities: {},
      rooms: {
        empty_room: {},
      },
    }
    const map = buildEntityMap(config)!
    expect(map.rooms).toEqual({})
  })

  it('handles empty entities dict', () => {
    const config = { entities: {}, rooms: {} }
    const map = buildEntityMap(config)!
    expect(map.rooms).toEqual({})
    expect(map.outdoor_temp).toBeUndefined()
    expect(map.hp_power).toBeUndefined()
  })

  it('falls back to independent_sensor when zone_sensor_map missing but sensor exists', () => {
    const config = {
      entities: {},
      rooms: {
        study: {
          independent_sensor: 'sensor.study_temp',
          trv_entity: 'climate.study_trv',
        },
      },
      zone_sensor_map: {},
    }
    const map = buildEntityMap(config)!
    expect(map.rooms.study.temp_sensor).toBe('sensor.study_temp')
  })
})
