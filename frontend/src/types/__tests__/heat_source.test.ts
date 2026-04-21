/**
 * INSTRUCTION-117E Task 8b — HeatSourceState type-narrowing sanity.
 *
 * Compile-time checks only. The two `@ts-expect-error` directives each
 * carry a description to satisfy `@typescript-eslint/ban-ts-comment`
 * (activated by `tseslint.configs.recommended`).
 */
import { describe, it, expect } from 'vitest'
import type { HeatSourceState } from '../api'

describe('HeatSourceState type narrowing', () => {
  it('accepts a valid heat_pump payload', () => {
    const hp: HeatSourceState = {
      type: 'heat_pump',
      input_power_kw: 2.1,
      thermal_output_kw: 7.6,
      thermal_output_source: 'computed',
      performance: { value: 3.6, source: 'live' },
      flow_temp: 40,
      return_temp: 35,
      delta_t: 5,
      flow_rate: 0.38,
    }
    expect(hp.type).toBe('heat_pump')
  })

  it('accepts a valid gas_boiler payload', () => {
    const boiler: HeatSourceState = {
      type: 'gas_boiler',
      input_power_kw: 12,
      thermal_output_kw: 10.68,
      thermal_output_source: 'computed',
      performance: { value: 0.89, source: 'config' },
      flow_temp: 55,
      return_temp: 40,
      delta_t: 15,
      flow_rate: 10,
    }
    expect(boiler.performance.source).toBe('config')
  })

  it('rejects bogus string literals at compile time', () => {
    // @ts-expect-error invalid provenance literal rejected by Literal union
    const badSource: HeatSourceState['performance']['source'] = 'interpolated'
    // @ts-expect-error invalid source type string rejected by Literal union
    const badType: HeatSourceState['type'] = 'coal_boiler'

    // Runtime values are erased — this assertion is just to silence
    // unused-variable lint on the test scope.
    expect([badSource, badType]).toHaveLength(2)
  })
})
