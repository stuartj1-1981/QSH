import { describe, it, expect } from 'vitest'
import { suggestOccupancyClass } from '../occupancy'

describe('suggestOccupancyClass', () => {
  it.each([
    ['occupancy', 'presence'],
    ['presence', 'presence'],
    ['motion', 'motion'],
  ] as const)('device_class=%s → %s', (deviceClass, expected) => {
    expect(suggestOccupancyClass(undefined, deviceClass)).toBe(expected)
  })

  it.each(['mmwave', 'radar', 'presence', 'ld2410', 'fp2'])(
    'entity id keyword "%s" → presence',
    (kw) => {
      expect(suggestOccupancyClass(`binary_sensor.lounge_${kw}`, undefined)).toBe('presence')
    },
  )

  it.each(['pir', 'motion', 'movement'])('entity id keyword "%s" → motion', (kw) => {
    expect(suggestOccupancyClass(`binary_sensor.lounge_${kw}`, undefined)).toBe('motion')
  })

  it('presence wins on collision — pir device with mmwave in its name', () => {
    expect(suggestOccupancyClass('binary_sensor.hall_mmwave_motion', undefined)).toBe('presence')
  })

  it('is case-insensitive', () => {
    expect(suggestOccupancyClass('binary_sensor.HALL_MMWAVE', undefined)).toBe('presence')
    expect(suggestOccupancyClass('binary_sensor.HALL_PIR', undefined)).toBe('motion')
  })

  it('device_class evidence outranks entity-id evidence', () => {
    // id says motion, device_class says presence — device_class wins (precedence 1 vs 3).
    expect(suggestOccupancyClass('binary_sensor.hall_pir', 'occupancy')).toBe('presence')
  })

  it('(undefined, undefined) → null', () => {
    expect(suggestOccupancyClass(undefined, undefined)).toBeNull()
  })

  it('unrelated id and no device_class → null', () => {
    expect(suggestOccupancyClass('binary_sensor.hall_window', undefined)).toBeNull()
  })
})
