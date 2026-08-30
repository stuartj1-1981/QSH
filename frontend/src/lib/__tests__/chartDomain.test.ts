import { describe, it, expect } from 'vitest'
import { tempDomainMin, tempDomainMax } from '../chartDomain'

describe('tempDomainMin', () => {
  it('floors typical values with 0.5 °C pad', () => {
    expect(tempDomainMin(17.3)).toBe(16)
  })

  it('handles the flat-line case', () => {
    expect(tempDomainMin(20)).toBe(19)
  })

  it('handles negative temperatures', () => {
    expect(tempDomainMin(-3.2)).toBe(-4)
  })

  it('falls back to 0 for non-finite input', () => {
    expect(tempDomainMin(Infinity)).toBe(0)
    expect(tempDomainMin(-Infinity)).toBe(0)
    expect(tempDomainMin(NaN)).toBe(0)
  })
})

describe('tempDomainMax', () => {
  it('ceils typical values with 0.5 °C pad', () => {
    expect(tempDomainMax(22.1)).toBe(23)
  })

  it('handles the flat-line case', () => {
    expect(tempDomainMax(20)).toBe(21)
  })

  it('handles negative temperatures', () => {
    expect(tempDomainMax(-0.4)).toBe(1)
  })

  it('falls back to 1 for non-finite input', () => {
    expect(tempDomainMax(Infinity)).toBe(1)
    expect(tempDomainMax(-Infinity)).toBe(1)
    expect(tempDomainMax(NaN)).toBe(1)
  })
})

describe('tempDomainMin / tempDomainMax invariant', () => {
  it('min is always strictly below max for any finite a <= b', () => {
    const pairs: Array<[number, number]> = [
      [20, 20],
      [17.3, 22.1],
      [-3.2, -0.4],
      [0, 0],
      [-10, 10],
    ]
    for (const [a, b] of pairs) {
      expect(tempDomainMin(a)).toBeLessThan(tempDomainMax(b))
    }
  })
})
