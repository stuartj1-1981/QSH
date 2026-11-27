/**
 * INSTRUCTION-646B — the off-power threshold helper mirrors the backend band
 * (0.05 to 1.0 kW) and type values (heat pump 0.1 kW, boiler 0.5 kW) of
 * INSTRUCTION-646A.
 */
import { describe, it, expect } from 'vitest'
import {
  OFF_POWER_THRESHOLD_MAX_KW,
  OFF_POWER_THRESHOLD_MIN_KW,
  defaultOffPowerThresholdKw,
  offPowerThresholdHelp,
  offPowerThresholdOutOfBand,
} from '../heat-source-types'

describe('off-power threshold helper (INSTRUCTION-646B)', () => {
  it('has the band of the backend', () => {
    expect([OFF_POWER_THRESHOLD_MIN_KW, OFF_POWER_THRESHOLD_MAX_KW]).toEqual([0.05, 1.0])
  })

  it('gives the type value with no setting', () => {
    expect(defaultOffPowerThresholdKw('heat_pump')).toBe(0.1)
    expect(defaultOffPowerThresholdKw('gshp')).toBe(0.1)
    expect(defaultOffPowerThresholdKw('gas_boiler')).toBe(0.5)
    expect(defaultOffPowerThresholdKw('oil_boiler')).toBe(0.5)
    expect(defaultOffPowerThresholdKw('lpg_boiler')).toBe(0.5)
  })

  it('gives 0.1 kW for a type outside the registry, as the backend does', () => {
    expect(defaultOffPowerThresholdKw('district_heat')).toBe(0.1)
    expect(defaultOffPowerThresholdKw(undefined)).toBe(0.1)
  })

  it('the help text gives a margin and the value with no setting', () => {
    expect(offPowerThresholdHelp('heat_pump')).toContain('clearly above')
    expect(offPowerThresholdHelp('heat_pump')).toMatch(/Blank uses 0\.1 kW\.$/)
    expect(offPowerThresholdHelp('lpg_boiler')).toMatch(/Blank uses 0\.5 kW\.$/)
  })

  it('flags only a set value outside the band', () => {
    expect(offPowerThresholdOutOfBand(undefined)).toBe(false)
    expect(offPowerThresholdOutOfBand(0.05)).toBe(false)
    expect(offPowerThresholdOutOfBand(0.2)).toBe(false)
    expect(offPowerThresholdOutOfBand(1.0)).toBe(false)
    expect(offPowerThresholdOutOfBand(0.04)).toBe(true)
    expect(offPowerThresholdOutOfBand(1.5)).toBe(true)
    expect(offPowerThresholdOutOfBand(Number.NaN)).toBe(true)
  })
})
