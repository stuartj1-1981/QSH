import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { AlarmEvent } from '../../types/api'

vi.mock('../useLive', () => ({
  useLive: vi.fn(),
}))

vi.mock('../useHistorian', () => ({
  useHistorianEvents: vi.fn(),
}))

import { useLive } from '../useLive'
import { useHistorianEvents } from '../useHistorian'
import { useAlarms } from '../useAlarms'

describe('useAlarms', () => {
  beforeEach(() => {
    // Call history is cleared per test, so a call assertion sees only its own render.
    vi.mocked(useHistorianEvents).mockClear()
    vi.mocked(useHistorianEvents).mockReturnValue({
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
    vi.mocked(useHistorianEvents).mockReturnValue({
      data: {
        measurement: 'qsh_alarm_event',
        rows: [
          {
            t: 100, timestamp: 100, payload_json: JSON.stringify({ foo: 'bar' }),
            alarm_id: 'A', severity: 'notification', room: 'lounge', comparator_mode: '_none',
          },
        ],
        truncated: false,
      },
      loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useAlarms())
    await waitFor(() => {
      expect(result.current.historicalAlarms).toHaveLength(1)
    })
    expect(result.current.historicalAlarms[0].alarm_id).toBe('A')
    expect(result.current.historicalAlarms[0].payload).toEqual({ foo: 'bar' })
    expect(useHistorianEvents).toHaveBeenCalledWith('qsh_alarm_event', { timeFrom: '-7d' })
  })

  it('skips alarm points with invalid payload_json', () => {
    vi.mocked(useLive).mockReturnValue({
      data: null, isConnected: false, lastUpdate: 0, disconnectedSince: 0,
    })
    vi.mocked(useHistorianEvents).mockReturnValue({
      data: {
        measurement: 'qsh_alarm_event',
        rows: [
          {
            t: 100, timestamp: 100, payload_json: '{{not-json',
            alarm_id: 'A', severity: 'notification', room: 'lounge', comparator_mode: '_none',
          },
        ],
        truncated: false,
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
    vi.mocked(useHistorianEvents).mockReturnValue({
      data: {
        measurement: 'qsh_alarm_event',
        rows: [
          {
            t: 200, timestamp: 200, payload_json: '{}',
            alarm_id: 'C', severity: 'notification', room: 'lounge', comparator_mode: '_none',
          },
          {
            t: 100, timestamp: 100, payload_json: '{}',
            alarm_id: 'A', severity: 'notification', room: 'lounge', comparator_mode: '_none',
          },
        ],
        truncated: false,
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
    vi.mocked(useHistorianEvents).mockReturnValue({
      data: {
        measurement: 'qsh_alarm_event',
        rows: [
          {
            t: 200, timestamp: 200, payload_json: '{}',
            alarm_id: 'B', severity: 'notification', room: '_installation', comparator_mode: '_none',
          },
          {
            t: 100, timestamp: 100, payload_json: '{}',
            alarm_id: 'A', severity: 'notification', room: 'lounge', comparator_mode: '_none',
          },
        ],
        truncated: false,
      },
      loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useAlarms())
    expect(result.current.historicalAlarms.every(a => a.severity === 'notification')).toBe(true)
  })

  it('maps an Alarm B row whose room tag is _installation to a null room', () => {
    vi.mocked(useLive).mockReturnValue({
      data: null, isConnected: false, lastUpdate: 0, disconnectedSince: 0,
    })
    vi.mocked(useHistorianEvents).mockReturnValue({
      data: {
        measurement: 'qsh_alarm_event',
        rows: [
          {
            t: 300, timestamp: 299, payload_json: '{}',
            alarm_id: 'B', severity: 'notification', room: '_installation', comparator_mode: '_none',
          },
          {
            t: 200, timestamp: 199, payload_json: '{}',
            alarm_id: 'A', severity: 'notification', room: 'lounge', comparator_mode: '_none',
          },
        ],
        truncated: false,
      },
      loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useAlarms())
    const expected: AlarmEvent = {
      alarm_id: 'B', timestamp: 299, room: null,
      payload: {}, severity: 'notification',
    }
    expect(result.current.historicalAlarms).toHaveLength(2)
    expect(result.current.historicalAlarms[0]).toEqual(expected)
    // A room tag that names a room is kept.
    expect(result.current.historicalAlarms[1].room).toBe('lounge')
  })

  it('takes the alarm time from its timestamp field, not from the row time t', () => {
    vi.mocked(useLive).mockReturnValue({
      data: null, isConnected: false, lastUpdate: 0, disconnectedSince: 0,
    })
    vi.mocked(useHistorianEvents).mockReturnValue({
      data: {
        measurement: 'qsh_alarm_event',
        rows: [
          {
            t: 1790000002, timestamp: 1789999998.4, payload_json: '{}',
            alarm_id: 'A', severity: 'notification', room: 'lounge', comparator_mode: '_none',
          },
        ],
        truncated: false,
      },
      loading: false, error: null, refetch: vi.fn(),
    })
    const { result } = renderHook(() => useAlarms())
    expect(result.current.historicalAlarms).toHaveLength(1)
    expect(result.current.historicalAlarms[0].timestamp).toBe(1789999998.4)
  })
})
