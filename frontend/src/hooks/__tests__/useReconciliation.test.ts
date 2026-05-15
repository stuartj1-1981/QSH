import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../useHistorian', () => ({
  useHistorianQuery: vi.fn(),
}))

import { useHistorianQuery } from '../useHistorian'
import { useReconciliation } from '../useReconciliation'

describe('useReconciliation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns points on happy path', () => {
    vi.mocked(useHistorianQuery).mockReturnValue({
      data: {
        measurement: 'qsh_forecast_reconciliation',
        fields: [],
        points: [
          {
            t: 100,
            controller: 'rl',
            room: 'lounge',
            weather_class: 'cold|low|calm',
            predicted: 21.0,
            actual: 20.5,
            error_c: -0.5,
            prediction_target_ts: 1000,
            basis_summary: null,
            basis_hash: null,
          } as never,
        ],
      },
      loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useReconciliation())
    expect(result.current.points).toHaveLength(1)
    expect(result.current.points[0].controller).toBe('rl')
    expect(result.current.points[0].error_c).toBe(-0.5)
  })

  it('filters by controller', () => {
    vi.mocked(useHistorianQuery).mockReturnValue({
      data: {
        measurement: 'qsh_forecast_reconciliation',
        fields: [],
        points: [
          { t: 100, controller: 'rl', room: 'lounge', error_c: -0.5 } as never,
          { t: 200, controller: 'shoulder_controller', room: 'lounge', error_c: 0.2 } as never,
          { t: 300, controller: 'rl', room: 'bed', error_c: 0.1 } as never,
        ],
      },
      loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useReconciliation('rl'))
    expect(result.current.points).toHaveLength(2)
    expect(result.current.points.every(p => p.controller === 'rl')).toBe(true)
  })

  it('undefined controller returns all points', () => {
    vi.mocked(useHistorianQuery).mockReturnValue({
      data: {
        measurement: 'qsh_forecast_reconciliation',
        fields: [],
        points: [
          { t: 100, controller: 'rl' } as never,
          { t: 200, controller: 'shoulder_controller' } as never,
        ],
      },
      loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useReconciliation())
    expect(result.current.points).toHaveLength(2)
  })

  it('returns loading when underlying query loading', () => {
    vi.mocked(useHistorianQuery).mockReturnValue({
      data: null, loading: true, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useReconciliation())
    expect(result.current.loading).toBe(true)
  })

  it('returns error when underlying query errors', () => {
    vi.mocked(useHistorianQuery).mockReturnValue({
      data: null, loading: false, error: 'historian unavailable', refetch: vi.fn(),
    })
    const { result } = renderHook(() => useReconciliation())
    expect(result.current.error).toBe('historian unavailable')
  })
})
