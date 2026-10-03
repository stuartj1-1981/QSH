import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { HistorianEventsResponse } from '../../types/api'

vi.mock('../useHistorian', () => ({
  useHistorianEvents: vi.fn(),
}))

import { useHistorianEvents } from '../useHistorian'
import { useReconciliation } from '../useReconciliation'

describe('useReconciliation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns points on happy path', () => {
    const data: HistorianEventsResponse = {
      measurement: 'qsh_forecast_reconciliation',
      rows: [
        {
          t: 100,
          controller: 'rl',
          room: 'lounge',
          oat_class: 'cold',
          solar_class: 'low',
          wind_class: 'calm',
          predicted: 21.0,
          actual: 20.5,
          error_c: -0.5,
          prediction_target_ts: 1000,
          basis_summary: null,
          basis_hash: null,
        },
      ],
      truncated: false,
    }
    vi.mocked(useHistorianEvents).mockReturnValue({
      data, loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useReconciliation())
    expect(result.current.points).toHaveLength(1)
    expect(result.current.points[0].controller).toBe('rl')
    expect(result.current.points[0].error_c).toBe(-0.5)
    expect(result.current.points[0].weather_class).toBe('cold/low/calm')
    // The time comes from the prediction target, not from the row time.
    expect(result.current.points[0].prediction_target_ts).toBe(1000)
  })

  it('filters by controller', () => {
    const data: HistorianEventsResponse = {
      measurement: 'qsh_forecast_reconciliation',
      rows: [
        {
          t: 100, controller: 'rl', room: 'lounge',
          oat_class: 'cold', solar_class: 'low', wind_class: 'calm', error_c: -0.5,
        },
        {
          t: 200, controller: 'shoulder_controller', room: 'lounge',
          oat_class: 'cold', solar_class: 'low', wind_class: 'calm', error_c: 0.2,
        },
        {
          t: 300, controller: 'rl', room: 'bed',
          oat_class: 'mild', solar_class: 'medium', wind_class: 'moderate', error_c: 0.1,
        },
      ],
      truncated: false,
    }
    vi.mocked(useHistorianEvents).mockReturnValue({
      data, loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useReconciliation('rl'))
    expect(result.current.points).toHaveLength(2)
    expect(result.current.points.every(p => p.controller === 'rl')).toBe(true)
  })

  it('undefined controller returns all points', () => {
    const data: HistorianEventsResponse = {
      measurement: 'qsh_forecast_reconciliation',
      rows: [
        {
          t: 100, controller: 'rl',
          oat_class: 'cold', solar_class: 'low', wind_class: 'calm',
        },
        {
          t: 200, controller: 'shoulder_controller',
          oat_class: 'warm', solar_class: 'high', wind_class: 'calm',
        },
      ],
      truncated: false,
    }
    vi.mocked(useHistorianEvents).mockReturnValue({
      data, loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useReconciliation())
    expect(result.current.points).toHaveLength(2)
  })

  it('returns loading when underlying query loading', () => {
    vi.mocked(useHistorianEvents).mockReturnValue({
      data: null, loading: true, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useReconciliation())
    expect(result.current.loading).toBe(true)
  })

  it('returns error when underlying query errors', () => {
    vi.mocked(useHistorianEvents).mockReturnValue({
      data: null, loading: false, error: 'historian unavailable', refetch: vi.fn(),
    })
    const { result } = renderHook(() => useReconciliation())
    expect(result.current.error).toBe('historian unavailable')
  })

  it('gives a null weather class when all three class tags are unknown', () => {
    const data: HistorianEventsResponse = {
      measurement: 'qsh_forecast_reconciliation',
      rows: [
        {
          t: 100, controller: 'valve_controller', room: 'lounge',
          oat_class: 'unknown', solar_class: 'unknown', wind_class: 'unknown',
          error_c: 0.3,
        },
        {
          t: 200, controller: 'valve_controller', room: 'lounge',
          oat_class: 'unknown', solar_class: 'low', wind_class: 'calm',
          error_c: 0.4,
        },
      ],
      truncated: false,
    }
    vi.mocked(useHistorianEvents).mockReturnValue({
      data, loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useReconciliation())
    expect(result.current.points).toHaveLength(2)
    expect(result.current.points[0].weather_class).toBeNull()
    // Only all three unknown gives null; one known tag keeps the class.
    expect(result.current.points[1].weather_class).toBe('unknown/low/calm')
  })

  it('passes controller, room and timeFrom to useHistorianEvents', () => {
    vi.mocked(useHistorianEvents).mockClear()
    vi.mocked(useHistorianEvents).mockReturnValue({
      data: null, loading: false, error: null, refetch: vi.fn(),
    })
    renderHook(() => useReconciliation('valve_controller', 'lounge', '-24h'))
    expect(useHistorianEvents).toHaveBeenCalledWith(
      'qsh_forecast_reconciliation',
      { controller: 'valve_controller', room: 'lounge', timeFrom: '-24h' },
    )
  })
})
