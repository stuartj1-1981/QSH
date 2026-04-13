import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMqttTopicScan } from '../useMqttTopicScan'

describe('useMqttTopicScan', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns discovered topics on successful scan', async () => {
    const mockTopics = [
      { topic: 'temps/outside', payload: '21.3', is_numeric: true },
      { topic: 'temps/lounge', payload: '19.8', is_numeric: true },
    ]
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ topics: mockTopics }),
    } as Response)

    const { result } = renderHook(() => useMqttTopicScan())

    await act(async () => {
      await result.current.scan()
    })

    expect(result.current.topics).toEqual(['temps/outside', 'temps/lounge'])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('URL uses apiUrl form', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ topics: [] }),
    } as Response)

    const { result } = renderHook(() => useMqttTopicScan())

    await act(async () => {
      await result.current.scan(5)
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('api/wizard/scan-mqtt-topics'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ duration: 5 }),
      }),
    )
  })

  it('sets error and clears topics on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network down'))

    const { result } = renderHook(() => useMqttTopicScan())

    await act(async () => {
      await result.current.scan()
    })

    expect(result.current.topics).toEqual([])
    expect(result.current.error).toBe('Network down')
    expect(result.current.loading).toBe(false)
  })

  it('handles HTTP error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'MQTT broker unreachable' }),
    } as Response)

    const { result } = renderHook(() => useMqttTopicScan())

    await act(async () => {
      await result.current.scan()
    })

    expect(result.current.error).toBe('MQTT broker unreachable')
    expect(result.current.topics).toEqual([])
  })

  it('handles empty topics response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ topics: [] }),
    } as Response)

    const { result } = renderHook(() => useMqttTopicScan())

    await act(async () => {
      await result.current.scan()
    })

    expect(result.current.topics).toEqual([])
    expect(result.current.error).toBeNull()
  })
})
