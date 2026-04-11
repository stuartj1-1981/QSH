import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useTrends } from '../useTrends'

describe('useTrends', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data shape with points array', async () => {
    const mockPoints = [
      { t: 1700000000, v: 10.5 },
      { t: 1700000030, v: 10.8 },
    ]
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ metric: 'outdoor_temp', room: null, points: mockPoints }),
    } as Response)

    const { result } = renderHook(() => useTrends('outdoor_temp'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toHaveLength(2)
    expect(result.current.data[0].t).toBe(1700000000)
    expect(result.current.data[0].v).toBe(10.5)
    expect(result.current.error).toBeNull()
  })

  it('handles fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useTrends('outdoor_temp'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Network error')
    expect(result.current.data).toHaveLength(0)
  })

  it('handles empty response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ metric: 'outdoor_temp', room: null, points: [] }),
    } as Response)

    const { result } = renderHook(() => useTrends('outdoor_temp'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toHaveLength(0)
    expect(result.current.error).toBeNull()
  })

  it('constructs correct URL with room parameter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ metric: 'temp', room: 'lounge', points: [] }),
    } as Response)

    renderHook(() => useTrends('temp', 12, 'lounge'))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toContain('metric=temp')
    expect(calledUrl).toContain('hours=12')
    expect(calledUrl).toContain('room=lounge')
  })

  it('handles HTTP error status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response)

    const { result } = renderHook(() => useTrends('outdoor_temp'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('HTTP 500')
  })
})
