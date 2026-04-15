import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMqttScan } from '../useMqttScan'

describe('useMqttScan', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('testConnection returns success shape on fetch success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Connected' }),
    } as Response)

    const { result } = renderHook(() => useMqttScan())

    let testResult: { success: boolean; message: string } | undefined
    await act(async () => {
      testResult = await result.current.testConnection({
        broker: 'localhost',
        port: 1883,
      })
    })

    expect(testResult?.success).toBe(true)
    expect(testResult?.message).toBe('Connected')
    expect(result.current.testResult?.success).toBe(true)
  })

  it('testConnection returns error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network down'))

    const { result } = renderHook(() => useMqttScan())

    let testResult: { success: boolean; message: string } | undefined
    await act(async () => {
      testResult = await result.current.testConnection({
        broker: 'localhost',
        port: 1883,
      })
    })

    expect(testResult?.success).toBe(false)
    expect(testResult?.message).toContain('Network')
  })

  it('scanTopics returns topics array', async () => {
    const mockTopics = [
      { topic: 'test/temp', payload: '21.3', is_numeric: true },
    ]
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ topics: mockTopics }),
    } as Response)

    const { result } = renderHook(() => useMqttScan())

    let topics: unknown[] = []
    await act(async () => {
      topics = await result.current.scanTopics({ broker: 'localhost', port: 1883 })
    })

    expect(topics).toHaveLength(1)
    expect(result.current.scanResults).toHaveLength(1)
  })

  it('scanTopics handles empty response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ topics: [] }),
    } as Response)

    const { result } = renderHook(() => useMqttScan())

    let topics: unknown[] = []
    await act(async () => {
      topics = await result.current.scanTopics({ broker: 'localhost', port: 1883 })
    })

    expect(topics).toHaveLength(0)
  })

  it('URLs use apiUrl (relative path)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'ok' }),
    } as Response)

    const { result } = renderHook(() => useMqttScan())

    await act(async () => {
      await result.current.testConnection({ broker: 'localhost', port: 1883 })
    })

    // apiUrl() returns './api/wizard/test-mqtt'
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('api/wizard/test-mqtt'),
      expect.anything(),
    )
  })

  // ── INSTRUCTION-93B ──────────────────────────────────────────────────

  it('scanTopics exposes scan_meta when present', async () => {
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

    const { result } = renderHook(() => useMqttScan())

    await act(async () => {
      await result.current.scanTopics({ broker: 'localhost', port: 1883 })
    })

    expect(result.current.scanMeta).not.toBeNull()
    expect(result.current.scanMeta?.window_seconds).toBe(30)
    expect(result.current.scanMeta?.partial_topics).toBe(0)
  })

  it('scanTopics keeps scanMeta null on legacy (missing) envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ topics: [{ topic: 'a', payload: '1', is_numeric: true }] }),
    } as Response)

    const { result } = renderHook(() => useMqttScan())

    await act(async () => {
      await result.current.scanTopics({ broker: 'localhost', port: 1883 })
    })

    expect(result.current.scanMeta).toBeNull()
    expect(result.current.scanResults).toHaveLength(1)
  })

  it('scanTopics forwards new request params in body when supplied', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ topics: [] }),
    } as Response)

    const { result } = renderHook(() => useMqttScan())

    await act(async () => {
      await result.current.scanTopics(
        { broker: 'localhost', port: 1883 },
        undefined,
        { windowSeconds: 90, aggregateJsonFields: false, preferRetained: true },
      )
    })

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.window_seconds).toBe(90)
    expect(body.aggregate_json_fields).toBe(false)
    expect(body.prefer_retained).toBe(true)
  })

  it('scanTopics omits new keys when not supplied (backend defaults apply)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ topics: [] }),
    } as Response)

    const { result } = renderHook(() => useMqttScan())

    await act(async () => {
      await result.current.scanTopics({ broker: 'localhost', port: 1883 })
    })

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty('window_seconds')
    expect(body).not.toHaveProperty('aggregate_json_fields')
    expect(body).not.toHaveProperty('prefer_retained')
  })
})
