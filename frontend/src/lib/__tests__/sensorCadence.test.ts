// INSTRUCTION-420 QG5 — the class copy renders the measured quantities and
// names the fix mechanism (string-asserted, V3/L1).

import { describe, it, expect } from 'vitest'
import { cadenceCopy, cadenceLabel, cadenceEventsPerDay } from '../sensorCadence'
import type { SensorCadence } from '../../types/api'

const base: SensorCadence = {
  class: 'ok',
  median_step_c: 0.1,
  median_interval_s: 1200,
  admissible_fraction: 1,
  event_count: 73,
  window_span_s: 86400,
}

describe('cadenceLabel', () => {
  it('maps API values to display labels (match on API value, not label)', () => {
    expect(cadenceLabel('ok')).toBe('OK')
    expect(cadenceLabel('coarse')).toBe('Coarse')
    expect(cadenceLabel('blocked')).toBe('Blocked')
    expect(cadenceLabel('insufficient')).toBe('Measuring')
  })
})

describe('cadenceCopy (QG5 string assertions)', () => {
  it('Blocked copy names deadband / minimum-report-interval / device class and the drill-down', () => {
    const copy = cadenceCopy({ ...base, class: 'blocked', admissible_fraction: 0 })
    expect(copy).toMatch(/cannot feed room learning at current settings/)
    expect(copy).toMatch(/reporting deadband/)
    expect(copy).toMatch(/minimum-report-interval/)
    expect(copy).toMatch(/device class/)
    expect(copy).toMatch(/U observation ledger/)
  })

  it('Coarse copy renders measured f, median step and updates/day', () => {
    const copy = cadenceCopy({
      ...base,
      class: 'coarse',
      admissible_fraction: 0.6,
      median_step_c: 0.18,
    })
    expect(copy).toMatch(/reduced rate/)
    expect(copy).toMatch(/60% admissible/)
    expect(copy).toMatch(/median step 0\.18 °C/)
    expect(copy).toMatch(/72\.0 updates\/day/)
  })

  it('post-417 OK copy for slow-but-admissible rooms renders updates/day (the rate context)', () => {
    const copy = cadenceCopy(base)
    expect(copy).toMatch(/compatible with room learning/)
    expect(copy).toMatch(/72\.0 updates\/day/)
  })

  it('Measuring copy is the honest insufficient state', () => {
    const copy = cadenceCopy({ ...base, class: 'insufficient', event_count: 2 })
    expect(copy).toMatch(/Measuring/)
    expect(copy).toMatch(/after the first night/)
  })
})

describe('cadenceEventsPerDay', () => {
  it('computes (n-1)/span-days and degrades to null', () => {
    expect(cadenceEventsPerDay(base)).toBe('72.0')
    expect(cadenceEventsPerDay({ ...base, event_count: 1 })).toBeNull()
    expect(cadenceEventsPerDay({ ...base, window_span_s: 0 })).toBeNull()
    expect(cadenceEventsPerDay({ ...base, window_span_s: null })).toBeNull()
  })
})
