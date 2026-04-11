import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useHistorianMeasurements, useHistorianQuery } from '../useHistorian'

describe('useHistorianMeasurements', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: true,
        measurements: [
          { name: 'qsh_system', fields: ['outdoor_temp', 'hp_power_kw'] },
          { name: 'qsh_room', fields: ['temperature', 'target'] },
        ],
      }),
    } as Response)

    const { result } = renderHook(() => useHistorianMeasurements())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data?.available).toBe(true)
    expect(result.current.data?.measurements).toHaveLength(2)
    expect(result.current.error).toBeNull()
  })

  it('handles fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection refused'))

    const { result } = renderHook(() => useHistorianMeasurements())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Connection refused')
  })

  it('handles not-configured state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: false,
        message: 'Historian not configured.',
        measurements: [],
      }),
    } as Response)

    const { result } = renderHook(() => useHistorianMeasurements())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data?.available).toBe(false)
  })
})

describe('useHistorianQuery', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns query data when measurement and fields provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        measurement: 'qsh_system',
        fields: ['outdoor_temp'],
        tags: {},
        points: [{ t: 1700000000, outdoor_temp: 10.5 }],
        aggregation: 'mean',
        interval: '5m',
      }),
    } as Response)

    const { result } = renderHook(() =>
      useHistorianQuery('qsh_system', ['outdoor_temp']),
    )

    await waitFor(() => {
      expect(result.current.data).not.toBeNull()
    })

    expect(result.current.data?.points).toHaveLength(1)
    expect(result.current.error).toBeNull()
  })

  it('handles fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Timeout'))

    const { result } = renderHook(() =>
      useHistorianQuery('qsh_system', ['outdoor_temp']),
    )

    await waitFor(() => {
      expect(result.current.error).toBe('Timeout')
    })
  })

  it('does not fetch when measurement is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    renderHook(() => useHistorianQuery('', []))

    // Give time for any potential async operations
    await new Promise((r) => setTimeout(r, 50))

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('constructs URL with room parameter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ points: [] }),
    } as Response)

    renderHook(() =>
      useHistorianQuery('qsh_room', ['temperature'], { room: 'lounge' }),
    )

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toContain('room=lounge')
    expect(calledUrl).toContain('measurement=qsh_room')
  })
})
