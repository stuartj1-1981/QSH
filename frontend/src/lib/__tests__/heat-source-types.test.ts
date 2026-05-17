import { describe, it, expect } from 'vitest'
import { isHeatPumpType } from '../heat-source-types'

describe('isHeatPumpType', () => {
  it('returns true for heat_pump', () => expect(isHeatPumpType('heat_pump')).toBe(true))
  it('returns true for gshp', () => expect(isHeatPumpType('gshp')).toBe(true))
  it('returns false for gas_boiler', () => expect(isHeatPumpType('gas_boiler')).toBe(false))
  it('returns false for lpg_boiler', () => expect(isHeatPumpType('lpg_boiler')).toBe(false))
  it('returns false for oil_boiler', () => expect(isHeatPumpType('oil_boiler')).toBe(false))
  it('returns false for undefined', () => expect(isHeatPumpType(undefined)).toBe(false))
})
