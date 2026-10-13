/**
 * INSTRUCTION-577F — the rate inputs show p/kWh and store £/kWh (OB-01): the
 * two conversions, the rounding that keeps a float residue out of qsh.yaml,
 * and the round trip of every value an input can hold to four decimal places
 * of a penny.
 */
import { describe, it, expect } from 'vitest'
import {
  LOW_RATE_HINT_GBP_PER_KWH,
  penceFromPounds,
  penceInputValue,
  poundsFromPence,
  rateBelowOnePenny,
} from '../pence'

describe('pence', () => {
  it('shows a rate in £/kWh as p/kWh', () => {
    expect(penceFromPounds(0.245)).toBe(24.5)
    expect(penceFromPounds(0.07)).toBe(7)
    expect(penceFromPounds(0.244965)).toBe(24.4965)
    expect(penceFromPounds(0)).toBe(0)
  })

  it('gives the rate in £/kWh of a value typed in p/kWh, with no float residue', () => {
    expect(poundsFromPence(24.5)).toBe(0.245)
    expect(poundsFromPence(7)).toBe(0.07)
    expect(poundsFromPence(6.24)).toBe(0.0624)
    expect(poundsFromPence(24.4965)).toBe(0.244965)
    expect(poundsFromPence(0)).toBe(0)
  })

  it('keeps a rate to four decimal places of a penny', () => {
    expect(poundsFromPence(24.49655)).toBe(0.244966)
    expect(penceFromPounds(0.2449651)).toBe(24.4965)
  })

  it('gives an empty input value for a stored rate that is not a finite number', () => {
    expect(penceInputValue(0.29)).toBe(29)
    expect(penceInputValue(0)).toBe(0)
    expect(penceInputValue(Number.NaN)).toBe('')
    expect(penceInputValue(Number.POSITIVE_INFINITY)).toBe('')
    expect(penceInputValue(undefined)).toBe('')
    expect(penceInputValue('0.3')).toBe('')
  })

  it('flags a rate above 0 and below 1p/kWh, and no other value', () => {
    expect(LOW_RATE_HINT_GBP_PER_KWH).toBe(0.01)
    expect(rateBelowOnePenny(0.00245)).toBe(true)
    expect(rateBelowOnePenny(0.0099)).toBe(true)
    expect(rateBelowOnePenny(0.01)).toBe(false)
    expect(rateBelowOnePenny(0.245)).toBe(false)
    expect(rateBelowOnePenny(0)).toBe(false)
    expect(rateBelowOnePenny(-0.005)).toBe(false)
    expect(rateBelowOnePenny(Number.NaN)).toBe(false)
    expect(rateBelowOnePenny('0.005')).toBe(false)
  })

  it('round-trips every value from 0 to 200 p/kWh at a step of 0.0001 p', () => {
    for (let k = 0; k <= 2_000_000; k += 1) {
      const pence = Number((k / 10_000).toFixed(4))
      const back = penceFromPounds(poundsFromPence(pence))
      if (back !== pence) throw new Error(`round trip of ${pence} gave ${back}`)
    }
  })
})
