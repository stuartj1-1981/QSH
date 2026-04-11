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
})
