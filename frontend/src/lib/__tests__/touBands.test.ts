/**
 * INSTRUCTION-577C — the arithmetic of a manual time-of-use day (OB-01, OB-02,
 * OB-03).
 */
import { describe, it, expect } from 'vitest'
import {
  ALL_STARTS,
  MINUTES_PER_DAY,
  allRatesAdmitted,
  bandEnd,
  bandFormAdmitted,
  bandLengths,
  defaultBands,
  formatLength,
  hydrateBands,
  moveStart,
  rateAdmitted,
  removeBand,
  setRate,
  splitBand,
  startOptions,
  toMinutes,
  toStart,
  totalMinutes,
} from '../touBands'
import type { TouBand } from '../../types/config'

// The EDF GoElectric shape of FI-93, sorted: peak 06:00 to 23:00, off-peak after.
const TWO: TouBand[] = [
  { start: '06:00', rate: 0.3 },
  { start: '23:00', rate: 0.08 },
]

/** The invariant of every list the module returns. */
function expectWholeDay(bands: TouBand[]) {
  const minutes = bands.map((b) => toMinutes(b.start))
  expect(bands.length).toBeGreaterThanOrEqual(1)
  expect(bands.length).toBeLessThanOrEqual(48)
  bands.forEach((b, i) => {
    // A start in the form the backend admits: "HH:MM", hour 00 to 23, minutes 00 or 30.
    expect(ALL_STARTS).toContain(b.start)
    if (i > 0) expect(minutes[i]).toBeGreaterThan(minutes[i - 1])
  })
  expect(totalMinutes(bands)).toBe(MINUTES_PER_DAY)
}

/** The price of each of the 48 half-hours of the day: the rate of the band
 *  with the latest start at or before the half-hour, else of the last band. */
function priceVector(bands: TouBand[]): number[] {
  return ALL_STARTS.map((slot) => {
    const minute = toMinutes(slot)
    const holders = bands.filter((b) => toMinutes(b.start) <= minute)
    return (holders.length > 0 ? holders[holders.length - 1] : bands[bands.length - 1]).rate
  })
}

/** The 48 slot offsets from minute p, cyclic, in half-hours. */
function slotOffset(slot: number, p: number): number {
  return ((slot * 30 - p + MINUTES_PER_DAY) % MINUTES_PER_DAY) / 30
}

describe('touBands — OB-01 the arithmetic', () => {
  it('converts every half-hour start and back', () => {
    expect(ALL_STARTS).toHaveLength(48)
    expect(ALL_STARTS[0]).toBe('00:00')
    expect(ALL_STARTS[47]).toBe('23:30')
    for (const start of ALL_STARTS) expect(toStart(toMinutes(start))).toBe(start)
    expect(toStart(MINUTES_PER_DAY + 90)).toBe('01:30')
    expect(toStart(-30)).toBe('23:30')
  })

  it('gives the length of each band and its end, with the last band past midnight', () => {
    expect(bandLengths(TWO)).toEqual([17 * 60, 7 * 60])
    expect(bandEnd(TWO, 0)).toBe('23:00')
    expect(bandEnd(TWO, 1)).toBe('06:00')
    expect(bandLengths(defaultBands(0.245))).toEqual([MINUTES_PER_DAY])
    expect(formatLength(17 * 60)).toBe('17 h')
    expect(formatLength(7 * 60 + 30)).toBe('7 h 30 min')
  })

  it('splits a band at its middle on the grid, else at the half-hour below it', () => {
    const split = splitBand(TWO, 0)
    expect(split).toEqual([
      { start: '06:00', rate: 0.3 },
      { start: '14:30', rate: 0.3 },
      { start: '23:00', rate: 0.08 },
    ])
    expectWholeDay(split)
    // A band of 90 minutes: the middle, 00:45, is off the grid, so 00:30.
    const odd: TouBand[] = [
      { start: '00:00', rate: 0.1 },
      { start: '01:30', rate: 0.2 },
    ]
    expect(splitBand(odd, 0)).toEqual([
      { start: '00:00', rate: 0.1 },
      { start: '00:30', rate: 0.1 },
      { start: '01:30', rate: 0.2 },
    ])
    const short: TouBand[] = [
      { start: '00:00', rate: 0.1 },
      { start: '00:30', rate: 0.2 },
    ]
    expect(splitBand(short, 0)).toBe(short)
    expect(splitBand(defaultBands(0.2), 0)).toEqual([
      { start: '00:00', rate: 0.2 },
      { start: '12:00', rate: 0.2 },
    ])
  })

  it('removes a band so the band before it runs on, and never the last band', () => {
    expect(removeBand(TWO, 1)).toEqual([{ start: '06:00', rate: 0.3 }])
    const one = defaultBands(0.2)
    expect(removeBand(one, 0)).toBe(one)
  })

  it('offers only the starts strictly between the neighbours, and refuses any other', () => {
    expect(startOptions(TWO, 1)).toHaveLength(47)
    expect(startOptions(TWO, 1)).not.toContain('06:00')
    const three = splitBand(TWO, 0)
    expect(startOptions(three, 1)[0]).toBe('06:30')
    expect(startOptions(three, 1).at(-1)).toBe('22:30')
    expect(moveStart(three, 1, '23:00')).toBe(three)
    expect(moveStart(three, 1, '05:00')).toBe(three)
    expect(moveStart(three, 1, '07:00')[1].start).toBe('07:00')
    // The first band may move back past midnight; the list stays sorted.
    expect(moveStart(TWO, 0, '23:30')).toEqual([
      { start: '23:00', rate: 0.08 },
      { start: '23:30', rate: 0.3 },
    ])
    expect(startOptions(defaultBands(0.2), 0)).toEqual([...ALL_STARTS])
  })

  it('sets a rate and hydrates a config list sorted, or one band when there is none', () => {
    expect(setRate(TWO, 1, 0.07)[1]).toEqual({ start: '23:00', rate: 0.07 })
    expect(hydrateBands([TWO[1], TWO[0]], 0.245)).toEqual(TWO)
    expect(hydrateBands(undefined, 0.245)).toEqual([{ start: '00:00', rate: 0.245 }])
    expect(hydrateBands([], 0.3)).toEqual([{ start: '00:00', rate: 0.3 }])
    // A list that the backend refuses for its form becomes one band: a start
    // that YAML read as a number, a start twice, a start off the half-hour, a
    // key other than start and rate, a mapping in place of a list.
    expect(bandFormAdmitted(TWO)).toBe(true)
    expect(bandFormAdmitted([])).toBe(false)
    expect(hydrateBands([{ start: 1380, rate: 0.08 }, TWO[0]], 0.245)).toEqual([
      { start: '00:00', rate: 0.245 },
    ])
    expect(hydrateBands([{ start: '06:00', rate: 0.3, end: '23:00' }], 0.2)).toEqual([
      { start: '00:00', rate: 0.2 },
    ])
    expect(hydrateBands({ start: '06:00', rate: 0.3 }, 0.2)).toEqual([{ start: '00:00', rate: 0.2 }])
    expect(hydrateBands([null], 0.2)).toEqual([{ start: '00:00', rate: 0.2 }])
    expect(hydrateBands([TWO[0], { start: '06:00', rate: 0.1 }], 0.2)).toEqual([
      { start: '00:00', rate: 0.2 },
    ])
    expect(hydrateBands([{ start: '06:15', rate: 0.1 }], 0.2)).toEqual([{ start: '00:00', rate: 0.2 }])
  })

  it('admits a rate that is a finite number above 0, as the backend does', () => {
    for (const rate of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rateAdmitted(rate)).toBe(false)
    }
    expect(rateAdmitted('0.08')).toBe(false)
    expect(rateAdmitted(undefined)).toBe(false)
    expect(rateAdmitted(0.001)).toBe(true)
    expect(allRatesAdmitted(TWO)).toBe(true)
    expect(allRatesAdmitted(setRate(TWO, 1, 0))).toBe(false)
  })
})

describe('touBands — OB-02 and OB-03 every edit keeps the whole day and the prices', () => {
  it('holds both over 2000 seeded random edits of every kind', () => {
    // Park–Miller (multiplier 48271): every product stays below 2^53, so the
    // sequence is exact in JavaScript and a failure reproduces.
    let seed = 577
    const next = (n: number) => {
      seed = (seed * 48271) % 2147483647
      return seed % n
    }
    const changed = { split: 0, remove: 0, moveStart: 0, moveEnd: 0, setRate: 0 }
    let firstBandWraps = 0
    let maxBands = 1
    let bands = defaultBands(0.245)
    for (let step = 0; step < 2000; step++) {
      const before = priceVector(bands)
      const index = next(bands.length)
      const draw = next(10)
      let after: TouBand[]
      if (draw < 3) {
        after = splitBand(bands, index)
        if (after !== bands) changed.split++
        // A split changes no price.
        expect(priceVector(after)).toEqual(before)
      } else if (draw < 4 && bands.length > 8) {
        after = removeBand(bands, index)
        changed.remove++
        // The removed band's half-hours take the rate of the band before it.
        const prev = bands[(index - 1 + bands.length) % bands.length]
        const lost = toMinutes(bands[index].start)
        const len = bandLengths(bands)[index] / 30
        const expected = before.map((price, slot) =>
          slotOffset(slot, lost) < len ? prev.rate : price,
        )
        expect(priceVector(after)).toEqual(expected)
      } else if (draw < 8) {
        // Move a start (draw 4–6) or an end, which is the next band's start (draw 7).
        const target = draw < 7 ? index : (index + 1) % bands.length
        const options = startOptions(bands, target)
        const start = options[next(options.length)]
        after = moveStart(bands, target, start)
        if (after !== bands) changed[draw < 7 ? 'moveStart' : 'moveEnd']++
        if (bands.length > 1) {
          if (target === 0 && toMinutes(start) > toMinutes(bands[bands.length - 1].start)) {
            firstBandWraps++
          }
          // Only the half-hours between the old and the new start change:
          // later, they take the previous band's rate; earlier, the moved band's.
          const p = toMinutes(bands[(target - 1 + bands.length) % bands.length].start)
          const o0 = slotOffset(toMinutes(bands[target].start) / 30, p)
          const o1 = slotOffset(toMinutes(start) / 30, p)
          const prevRate = bands[(target - 1 + bands.length) % bands.length].rate
          const expected = before.map((price, slot) => {
            const o = slotOffset(slot, p)
            if (o1 > o0 && o >= o0 && o < o1) return prevRate
            if (o1 < o0 && o >= o1 && o < o0) return bands[target].rate
            return price
          })
          expect(priceVector(after)).toEqual(expected)
        } else {
          expect(priceVector(after)).toEqual(before)
        }
      } else {
        const rate = (next(500) + 1) / 1000
        after = setRate(bands, index, rate)
        if (rate !== bands[index].rate) changed.setRate++
        // Only the half-hours of that band change, to the new rate.
        const own = toMinutes(bands[index].start)
        const len = bandLengths(bands)[index] / 30
        const expected = before.map((price, slot) =>
          slotOffset(slot, own) < len ? rate : price,
        )
        expect(priceVector(after)).toEqual(expected)
      }
      bands = after
      maxBands = Math.max(maxBands, bands.length)
      expectWholeDay(bands)
    }
    // The run reaches every kind of edit, long lists and a first band moved past midnight.
    for (const count of Object.values(changed)) expect(count).toBeGreaterThan(0)
    expect(maxBands).toBeGreaterThanOrEqual(24)
    expect(firstBandWraps).toBeGreaterThan(0)
  })
})
