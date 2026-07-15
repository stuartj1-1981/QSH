import { describe, it, expect } from 'vitest'
import {
  ABSOLUTE_FLOW_CAPABILITY,
  FLOW_CAPABILITY_DEFAULTS,
  effectiveCapability,
  resolvedCapabilityInverts,
} from '../heatSourceCapability'

// INSTRUCTION-412 — frontend mirror of the backend capability resolution.
// These MUST agree with qsh/heat_source_limits.py + source_capabilities.py.

describe('heatSourceCapability mirror', () => {
  it('absolute band matches the backend constant', () => {
    expect(ABSOLUTE_FLOW_CAPABILITY).toEqual([20, 90])
  })

  it('registry defaults match the backend registry', () => {
    expect(FLOW_CAPABILITY_DEFAULTS.gas_boiler).toEqual({ floor: 50, ceiling: 80 })
    expect(FLOW_CAPABILITY_DEFAULTS.heat_pump).toEqual({ floor: 25, ceiling: 55 })
    expect(FLOW_CAPABILITY_DEFAULTS.oil_boiler).toEqual({ floor: 55, ceiling: 80 })
  })

  it('unasserted resolves to the type registry envelope', () => {
    expect(effectiveCapability('gas_boiler', undefined, undefined)).toEqual([50, 80])
  })

  it('per-axis assertion widens one axis, keeps the type default on the other', () => {
    expect(effectiveCapability('gas_boiler', undefined, 85)).toEqual([50, 85])
    expect(effectiveCapability('gas_boiler', 30, undefined)).toEqual([30, 80])
  })

  it('both axes asserted are honoured when coherent and in band', () => {
    expect(effectiveCapability('gas_boiler', 30, 85)).toEqual([30, 85])
  })

  it('out-of-band axis falls back to the registry value for that axis', () => {
    expect(effectiveCapability('gas_boiler', 15, 85)).toEqual([50, 85])
  })

  it('an inverted resolved pair reverts BOTH axes to registry', () => {
    // single-axis inversion against the other axis registry default
    expect(effectiveCapability('gas_boiler', undefined, 45)).toEqual([50, 80])
    expect(effectiveCapability('oil_boiler', 85, undefined)).toEqual([55, 80])
    // both asserted, inverted
    expect(effectiveCapability('gas_boiler', 70, 60)).toEqual([50, 80])
  })

  it('resolvedCapabilityInverts detects the fail-loud incoherent cases', () => {
    expect(resolvedCapabilityInverts('gas_boiler', undefined, 45)).toBe(true)
    expect(resolvedCapabilityInverts('oil_boiler', 85, undefined)).toBe(true)
    expect(resolvedCapabilityInverts('gas_boiler', 70, 60)).toBe(true)
    // coherent pairs
    expect(resolvedCapabilityInverts('gas_boiler', 30, 85)).toBe(false)
    expect(resolvedCapabilityInverts('gas_boiler', undefined, 85)).toBe(false)
    expect(resolvedCapabilityInverts('gas_boiler', undefined, undefined)).toBe(false)
  })
})
