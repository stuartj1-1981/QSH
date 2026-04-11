import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { intervalToHours, useStatistics } from '../useStatistics'

vi.mock('../useHistorian', () => ({
  useHistorianMeasurements: vi.fn(),
  useHistorianQuery: vi.fn(),
}))

import { useHistorianMeasurements, useHistorianQuery } from '../useHistorian'

const mockMeasurements = useHistorianMeasurements as ReturnType<typeof vi.fn>
const mockQuery = useHistorianQuery as ReturnType<typeof vi.fn>

describe('intervalToHours', () => {
  it.each([
    ['1m', 1 / 60],
    ['5m', 5 / 60],
    ['15m', 0.25],
    ['30m', 0.5],
    ['1h', 1],
    ['6h', 6],
    ['12h', 12],
    ['1d', 24],
  ])('parses %s to %d hours', (input, expected) => {
    expect(intervalToHours(input)).toBeCloseTo(expected)
  })

  it('returns 1 and warns for unknown format', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(intervalToHours('foo')).toBe(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('foo'))
    warnSpy.mockRestore()
  })
})

describe('useStatistics', () => {
  const refetchMean = vi.fn()
  const refetchMax = vi.fn()

  beforeEach(() => {
    mockMeasurements.mockReturnValue({
      data: { available: true, measurements: [] },
      loading: false,
      error: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('computes totalEnergy_kWh from mean power values', () => {
    const points = [
      { t: 1000, hp_power_kw: 2.0, tariff_rate: 0.30, cop: 3.0 },
      { t: 2000, hp_power_kw: 4.0, tariff_rate: 0.25, cop: 2.5 },
      { t: 3000, hp_power_kw: 3.0, tariff_rate: 0.35, cop: 3.5 },
    ]

    mockQuery
      .mockReturnValueOnce({ data: { points }, loading: false, error: null, refetch: refetchMean })
      .mockReturnValueOnce({ data: { points: [{ t: 1000, hp_power_kw: 5.0 }] }, loading: false, error: null, refetch: refetchMax })

    const { result } = renderHook(() => useStatistics('-24h', 'now()', '1h'))

    // Energy = (2.0 + 4.0 + 3.0) * 1h = 9.0 kWh
    expect(result.current.kpis?.totalEnergy_kWh).toBeCloseTo(9.0)
  })

  it('computes totalCost_pence from power * tariff', () => {
    const points = [
      { t: 1000, hp_power_kw: 2.0, tariff_rate: 0.30, cop: 3.0 },
      { t: 2000, hp_power_kw: 4.0, tariff_rate: 0.25, cop: 2.5 },
    ]

    mockQuery
      .mockReturnValueOnce({ data: { points }, loading: false, error: null, refetch: refetchMean })
      .mockReturnValueOnce({ data: { points: [] }, loading: false, error: null, refetch: refetchMax })

    const { result } = renderHook(() => useStatistics('-24h', 'now()', '1h'))

    // Cost = (2.0*0.30 + 4.0*0.25) * 1h * 100 = (0.60 + 1.00) * 100 = 160 pence
    expect(result.current.kpis?.totalCost_pence).toBeCloseTo(160)
  })

  it('computes avgCop excluding null values', () => {
    const points = [
      { t: 1000, hp_power_kw: 2.0, tariff_rate: 0.30, cop: 3.0 },
      { t: 2000, hp_power_kw: 4.0, tariff_rate: 0.25, cop: null },
      { t: 3000, hp_power_kw: 3.0, tariff_rate: 0.35, cop: 4.0 },
    ]

    mockQuery
      .mockReturnValueOnce({ data: { points }, loading: false, error: null, refetch: refetchMean })
      .mockReturnValueOnce({ data: { points: [] }, loading: false, error: null, refetch: refetchMax })

    const { result } = renderHook(() => useStatistics('-24h', 'now()', '1h'))

    // avgCop = (3.0 + 4.0) / 2 = 3.5
    expect(result.current.kpis?.avgCop).toBeCloseTo(3.5)
  })

  it('computes peakPower_kW from max query', () => {
    const meanPoints = [{ t: 1000, hp_power_kw: 2.0, tariff_rate: 0.30, cop: 3.0 }]
    const maxPoints = [
      { t: 1000, hp_power_kw: 3.5 },
      { t: 2000, hp_power_kw: 7.2 },
      { t: 3000, hp_power_kw: 5.1 },
    ]

    mockQuery
      .mockReturnValueOnce({ data: { points: meanPoints }, loading: false, error: null, refetch: refetchMean })
      .mockReturnValueOnce({ data: { points: maxPoints }, loading: false, error: null, refetch: refetchMax })

    const { result } = renderHook(() => useStatistics('-24h', 'now()', '1h'))

    expect(result.current.kpis?.peakPower_kW).toBeCloseTo(7.2)
  })

  it('returns available false when historian not configured', () => {
    mockMeasurements.mockReturnValue({
      data: { available: false, measurements: [] },
      loading: false,
      error: null,
    })

    mockQuery
      .mockReturnValueOnce({ data: null, loading: false, error: null, refetch: refetchMean })
      .mockReturnValueOnce({ data: null, loading: false, error: null, refetch: refetchMax })

    const { result } = renderHook(() => useStatistics('-24h', 'now()', '1h'))

    expect(result.current.available).toBe(false)
    expect(result.current.kpis).toBeNull()
  })

  it('returns loading true when either sub-query is loading', () => {
    mockQuery
      .mockReturnValueOnce({ data: null, loading: true, error: null, refetch: refetchMean })
      .mockReturnValueOnce({ data: null, loading: false, error: null, refetch: refetchMax })

    const { result } = renderHook(() => useStatistics('-24h', 'now()', '1h'))

    expect(result.current.loading).toBe(true)
  })
})
