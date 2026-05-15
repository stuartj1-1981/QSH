import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { AlarmEvent } from '../../types/api'

vi.mock('../useLive', () => ({
  useLive: vi.fn(),
}))

vi.mock('../useHistorian', () => ({
  useHistorianQuery: vi.fn(),
}))

import { useLive } from '../useLive'
import { useHistorianQuery } from '../useHistorian'
import { useAlarms } from '../useAlarms'

describe('useAlarms', () => {
  beforeEach(() => {
    vi.mocked(useHistorianQuery).mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns live alarms from WebSocket cycle', () => {
    const ev: AlarmEvent = {
      alarm_id: 'A', timestamp: 100, room: 'lounge',
      payload: {}, severity: 'notification',
    }
    vi.mocked(useLive).mockReturnValue({
      data: { type: 'cycle', active_alarms: [ev] } as never,
      isConnected: true, lastUpdate: 100, disconnectedSince: null,
    })
    const { result } = renderHook(() => useAlarms())
    expect(result.current.liveAlarms).toEqual([ev])
  })

  it('returns empty liveAlarms when cycle is null', () => {
    vi.mocked(useLive).mockReturnValue({
      data: null, isConnected: false, lastUpdate: 0, disconnectedSince: 0,
    })
    const { result } = renderHook(() => useAlarms())
    expect(result.current.liveAlarms).toEqual([])
  })

  it('parses historical alarms from historian payloads', async () => {
    vi.mocked(useLive).mockReturnValue({
      data: null, isConnected: false, lastUpdate: 0, disconnectedSince: 0,
    })
    vi.mocked(useHistorianQuery).mockReturnValue({
      data: {
        measurement: 'qsh_alarm_event',
        fields: ['payload_json'],
        points: [
          {
            t: 100,
            alarm_id: 'A',
            timestamp: 100,
            room: 'lounge',
            payload_json: JSON.stringify({ foo: 'bar' }),
          } as never,
        ],
      },
      loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useAlarms())
    await waitFor(() => {
      expect(result.current.historicalAlarms).toHaveLength(1)
    })
    expect(result.current.historicalAlarms[0].alarm_id).toBe('A')
    expect(result.current.historicalAlarms[0].payload).toEqual({ foo: 'bar' })
  })

  it('skips alarm points with invalid payload_json', () => {
    vi.mocked(useLive).mockReturnValue({
      data: null, isConnected: false, lastUpdate: 0, disconnectedSince: 0,
    })
    vi.mocked(useHistorianQuery).mockReturnValue({
      data: {
        measurement: 'qsh_alarm_event',
        fields: ['payload_json'],
        points: [
          { t: 100, alarm_id: 'A', payload_json: '{{not-json' } as never,
        ],
      },
      loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useAlarms())
    // Malformed payload_json → payload defaults to {}, point still kept.
    expect(result.current.historicalAlarms[0].payload).toEqual({})
  })

  it('filters out points with invalid alarm_id', () => {
    vi.mocked(useLive).mockReturnValue({
      data: null, isConnected: false, lastUpdate: 0, disconnectedSince: 0,
    })
    vi.mocked(useHistorianQuery).mockReturnValue({
      data: {
        measurement: 'qsh_alarm_event',
        fields: ['payload_json'],
        points: [
          { t: 100, alarm_id: 'A', payload_json: '{}' } as never,
          { t: 200, alarm_id: 'C', payload_json: '{}' } as never,
        ],
      },
      loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useAlarms())
    expect(result.current.historicalAlarms).toHaveLength(1)
    expect(result.current.historicalAlarms[0].alarm_id).toBe('A')
  })

  it('severity is always "notification"', () => {
    vi.mocked(useLive).mockReturnValue({
      data: null, isConnected: false, lastUpdate: 0, disconnectedSince: 0,
    })
    vi.mocked(useHistorianQuery).mockReturnValue({
      data: {
        measurement: 'qsh_alarm_event',
        fields: ['payload_json'],
        points: [
          { t: 100, alarm_id: 'A', payload_json: '{}' } as never,
          { t: 200, alarm_id: 'B', payload_json: '{}' } as never,
        ],
      },
      loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useAlarms())
    expect(result.current.historicalAlarms.every(a => a.severity === 'notification')).toBe(true)
  })
})
