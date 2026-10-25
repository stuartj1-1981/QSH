import { describe, it, expect } from 'vitest'
import { LOCATION_LEVELS, telemetryLocationFields } from '../locationLevels'

describe('LOCATION_LEVELS', () => {
  it('holds the levels region, district and sector, in that order', () => {
    expect(LOCATION_LEVELS.map((e) => e.level)).toEqual(['region', 'district', 'sector'])
  })

  it('gives the region level no privacy note and no placeholder, and the other two both', () => {
    const [region, district, sector] = LOCATION_LEVELS
    expect(region.privacyNote).toBeNull()
    expect(region.placeholder).toBeNull()
    for (const entry of [district, sector]) {
      expect(entry.privacyNote).not.toBeNull()
      expect(entry.placeholder).not.toBeNull()
    }
  })
})

describe('telemetryLocationFields', () => {
  it('gives no field when data sharing is off', () => {
    const fields = telemetryLocationFields(false, 'uk', 'district', 'zz99')
    expect(Object.keys(fields)).toHaveLength(0)
  })

  it('gives no field in International mode', () => {
    const fields = telemetryLocationFields(true, 'international', 'sector', 'ZZ99 9')
    expect(Object.keys(fields)).toHaveLength(0)
  })

  it('gives no field at the region level', () => {
    const fields = telemetryLocationFields(true, 'uk', 'region', 'zz99')
    expect(Object.keys(fields)).toHaveLength(0)
  })

  it('gives the level and the fragment as typed at the district level', () => {
    expect(telemetryLocationFields(true, 'uk', 'district', 'zz99')).toEqual({
      location_level: 'district',
      location_code: 'zz99',
    })
  })
})
