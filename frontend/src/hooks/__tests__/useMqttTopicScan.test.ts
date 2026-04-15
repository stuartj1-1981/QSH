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

  it('URL uses apiUrl form and forwards window_seconds', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ topics: [] }),
    } as Response)

    const { result } = renderHook(() => useMqttTopicScan())

    await act(async () => {
      await result.current.scan(60)
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('api/wizard/scan-mqtt-topics'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ window_seconds: 60 }),
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

  // ── INSTRUCTION-93B ──────────────────────────────────────────────────

  it('exposes scanMeta when backend returns envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        topics: [{ topic: 'a/b', payload: '{}', is_numeric: false }],
        scan_meta: {
          started_at: 1700000000,
          duration_s: 30.2,
          window_seconds: 30,
          total_topics: 1,
          partial_topics: 0,
        },
      }),
    } as Response)

    const { result } = renderHook(() => useMqttTopicScan())

    await act(async () => {
      await result.current.scan()
    })

    expect(result.current.scanMeta).not.toBeNull()
    expect(result.current.scanMeta?.window_seconds).toBe(30)
  })

  it('scanMeta is null on legacy (missing) envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ topics: [{ topic: 'a', payload: '1', is_numeric: true }] }),
    } as Response)

    const { result } = renderHook(() => useMqttTopicScan())

    await act(async () => {
      await result.current.scan()
    })

    expect(result.current.scanMeta).toBeNull()
    expect(result.current.topics).toEqual(['a'])
  })

  it('scan() with no argument omits window_seconds so backend defaults apply', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ topics: [] }),
    } as Response)

    const { result } = renderHook(() => useMqttTopicScan())

    await act(async () => {
      await result.current.scan()
    })

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty('window_seconds')
    expect(body).not.toHaveProperty('duration')
  })
})
