import { describe, it, expect, vi } from 'vitest'
import { parseOperatingState } from '../parseOperatingState'

describe('parseOperatingState', () => {
  // ── All 18 operating states ──

  it('parses Winter (Heating)', () => {
    const r = parseOperatingState('Winter (Heating)')
    expect(r.season).toBe('winter')
    expect(r.strategy).toBe('heating')
    expect(r.hwState).toBeNull()
    expect(r.cyclePause).toBeNull()
    expect(r.label).toBe('Winter (Heating)')
  })

  it('parses Winter (Equilibrium)', () => {
    const r = parseOperatingState('Winter (Equilibrium)')
    expect(r.season).toBe('winter')
    expect(r.strategy).toBe('equilibrium')
    expect(r.hwState).toBeNull()
    expect(r.cyclePause).toBeNull()
  })

  it('parses Winter (HW Pre-Charge)', () => {
    const r = parseOperatingState('Winter (HW Pre-Charge)')
    expect(r.season).toBe('winter')
    expect(r.strategy).toBe('hw')
    expect(r.hwState).toBe('pre_charge')
    expect(r.cyclePause).toBeNull()
  })

  it('parses Winter (HW Active)', () => {
    const r = parseOperatingState('Winter (HW Active)')
    expect(r.season).toBe('winter')
    expect(r.strategy).toBe('hw')
    expect(r.hwState).toBe('hw_active')
    expect(r.cyclePause).toBeNull()
  })

  it('parses Winter (HW Recovery)', () => {
    const r = parseOperatingState('Winter (HW Recovery)')
    expect(r.season).toBe('winter')
    expect(r.strategy).toBe('hw')
    expect(r.hwState).toBe('recovery')
    expect(r.cyclePause).toBeNull()
  })

  it('parses Winter (Defrost)', () => {
    const r = parseOperatingState('Winter (Defrost)')
    expect(r.season).toBe('winter')
    expect(r.strategy).toBe('cycle_pause')
    expect(r.hwState).toBeNull()
    expect(r.cyclePause).toBe('defrost')
  })

  it('parses Winter (Oil Recovery)', () => {
    const r = parseOperatingState('Winter (Oil Recovery)')
    expect(r.season).toBe('winter')
    expect(r.strategy).toBe('cycle_pause')
    expect(r.hwState).toBeNull()
    expect(r.cyclePause).toBe('oil_recovery')
  })

  it('parses Winter (Short Cycle Pause)', () => {
    const r = parseOperatingState('Winter (Short Cycle Pause)')
    expect(r.season).toBe('winter')
    expect(r.strategy).toBe('cycle_pause')
    expect(r.hwState).toBeNull()
    expect(r.cyclePause).toBe('short_cycle')
  })

  it('parses Shoulder (Heating)', () => {
    const r = parseOperatingState('Shoulder (Heating)')
    expect(r.season).toBe('shoulder')
    expect(r.strategy).toBe('heating')
    expect(r.hwState).toBeNull()
    expect(r.cyclePause).toBeNull()
  })

  it('parses Shoulder (Monitoring)', () => {
    const r = parseOperatingState('Shoulder (Monitoring)')
    expect(r.season).toBe('shoulder')
    expect(r.strategy).toBe('monitoring')
    expect(r.hwState).toBeNull()
    expect(r.cyclePause).toBeNull()
  })

  it('parses Shoulder (HW Pre-Charge)', () => {
    const r = parseOperatingState('Shoulder (HW Pre-Charge)')
    expect(r.season).toBe('shoulder')
    expect(r.strategy).toBe('hw')
    expect(r.hwState).toBe('pre_charge')
    expect(r.cyclePause).toBeNull()
  })

  it('parses Shoulder (HW Active)', () => {
    const r = parseOperatingState('Shoulder (HW Active)')
    expect(r.season).toBe('shoulder')
    expect(r.strategy).toBe('hw')
    expect(r.hwState).toBe('hw_active')
    expect(r.cyclePause).toBeNull()
  })

  it('parses Shoulder (HW Recovery)', () => {
    const r = parseOperatingState('Shoulder (HW Recovery)')
    expect(r.season).toBe('shoulder')
    expect(r.strategy).toBe('hw')
    expect(r.hwState).toBe('recovery')
    expect(r.cyclePause).toBeNull()
  })

  it('parses Shoulder (Defrost)', () => {
    const r = parseOperatingState('Shoulder (Defrost)')
    expect(r.season).toBe('shoulder')
    expect(r.strategy).toBe('cycle_pause')
    expect(r.hwState).toBeNull()
    expect(r.cyclePause).toBe('defrost')
  })

  it('parses Shoulder (Oil Recovery)', () => {
    const r = parseOperatingState('Shoulder (Oil Recovery)')
    expect(r.season).toBe('shoulder')
    expect(r.strategy).toBe('cycle_pause')
    expect(r.hwState).toBeNull()
    expect(r.cyclePause).toBe('oil_recovery')
  })

  it('parses Shoulder (Short Cycle Pause)', () => {
    const r = parseOperatingState('Shoulder (Short Cycle Pause)')
    expect(r.season).toBe('shoulder')
    expect(r.strategy).toBe('cycle_pause')
    expect(r.hwState).toBeNull()
    expect(r.cyclePause).toBe('short_cycle')
  })

  it('parses Summer (Monitoring)', () => {
    const r = parseOperatingState('Summer (Monitoring)')
    expect(r.season).toBe('summer')
    expect(r.strategy).toBe('monitoring')
    expect(r.hwState).toBeNull()
    expect(r.cyclePause).toBeNull()
  })

  it('parses Monitoring Only as shadow mode', () => {
    const r = parseOperatingState('Monitoring Only')
    expect(r.season).toBe('shadow')
    expect(r.strategy).toBe('shadow')
    expect(r.hwState).toBeNull()
    expect(r.cyclePause).toBeNull()
    expect(r.label).toBe('Monitoring Only')
  })

  // ── Shadow composite states (148A) ──

  it('parses Shadow (Heating)', () => {
    const r = parseOperatingState('Shadow (Heating)')
    expect(r.season).toBe('shadow')
    expect(r.strategy).toBe('heating')
    expect(r.hwState).toBeNull()
    expect(r.cyclePause).toBeNull()
    expect(r.label).toBe('Shadow (Heating)')
  })

  it('parses Shadow (HW Active)', () => {
    const r = parseOperatingState('Shadow (HW Active)')
    expect(r.season).toBe('shadow')
    expect(r.strategy).toBe('hw')
    expect(r.hwState).toBe('hw_active')
    expect(r.cyclePause).toBeNull()
  })

  it('parses Shadow (HW Pre-Charge)', () => {
    const r = parseOperatingState('Shadow (HW Pre-Charge)')
    expect(r.season).toBe('shadow')
    expect(r.strategy).toBe('hw')
    expect(r.hwState).toBe('pre_charge')
  })

  it('parses Shadow (HW Recovery)', () => {
    const r = parseOperatingState('Shadow (HW Recovery)')
    expect(r.season).toBe('shadow')
    expect(r.strategy).toBe('hw')
    expect(r.hwState).toBe('recovery')
  })

  it('parses Shadow (Defrost)', () => {
    const r = parseOperatingState('Shadow (Defrost)')
    expect(r.season).toBe('shadow')
    expect(r.strategy).toBe('cycle_pause')
    expect(r.cyclePause).toBe('defrost')
  })

  it('parses Shadow (Equilibrium)', () => {
    const r = parseOperatingState('Shadow (Equilibrium)')
    expect(r.season).toBe('shadow')
    expect(r.strategy).toBe('equilibrium')
  })

  it('parses Shadow (Monitoring)', () => {
    const r = parseOperatingState('Shadow (Monitoring)')
    expect(r.season).toBe('shadow')
    expect(r.strategy).toBe('monitoring')
  })

  // ── Edge cases ──

  it('returns fallback for null input', () => {
    const r = parseOperatingState(null)
    expect(r.season).toBe('winter')
    expect(r.strategy).toBe('heating')
    expect(r.label).toBe('Unknown')
  })

  it('returns fallback for undefined input', () => {
    const r = parseOperatingState(undefined)
    expect(r.season).toBe('winter')
    expect(r.strategy).toBe('heating')
    expect(r.label).toBe('Unknown')
  })

  it('returns fallback for empty string', () => {
    const r = parseOperatingState('')
    expect(r.season).toBe('winter')
    expect(r.strategy).toBe('heating')
    // Empty string is falsy, so raw ?? 'Unknown' yields '' (empty string)
    expect(r.label).toBe('')
  })

  it('returns fallback for unrecognised format', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = parseOperatingState('Galactic (Warp Drive)')
    expect(r.season).toBe('winter')
    expect(r.strategy).toBe('heating')
    expect(r.label).toBe('Galactic (Warp Drive)')
    spy.mockRestore()
  })

  it('preserves original label in all cases', () => {
    expect(parseOperatingState('Winter (Heating)').label).toBe('Winter (Heating)')
    expect(parseOperatingState('Monitoring Only').label).toBe('Monitoring Only')
    expect(parseOperatingState(null).label).toBe('Unknown')
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseOperatingState('Foo (Bar)').label).toBe('Foo (Bar)')
    spy.mockRestore()
  })

  // M1: Diagnostic path
  it('logs console.warn for unrecognised state string', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    parseOperatingState('Unknown (Something New)')
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown operating state')
    )
    spy.mockRestore()
  })
})
