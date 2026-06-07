import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useScop } from '../useScop'
import type { ScopResponse } from '../../types/api'

const mockResponse: ScopResponse = {
  available: true,
  window: '30d',
  mode: 'combined',
  window_start: '-30d',
  window_end: 'now()',
  scop: 3.42,
  thermal_kwh: 1234.5,
  electrical_kwh: 360.9,
}

describe('useScop', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns loading state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {}), // never resolves
    )

    const { result } = renderHook(() => useScop('30d', 'combined'))

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('returns data on successful fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const { result } = renderHook(() => useScop('30d', 'combined'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toEqual(mockResponse)
    expect(result.current.error).toBeNull()
  })

  it('returns error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('Network failure'),
    )

    const { result } = renderHook(() => useScop('30d', 'combined'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Network failure')
    expect(result.current.data).toBeNull()
  })

  it('returns error on non-OK HTTP status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response)

    const { result } = renderHook(() => useScop('30d', 'combined'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('HTTP 500')
  })

  it('re-fetches when window changes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const { rerender } = renderHook(
      ({ window }: { window: '30d' | '7d' }) => useScop(window, 'combined'),
      { initialProps: { window: '30d' as '30d' | '7d' } },
    )

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    rerender({ window: '7d' })

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    const lastCallUrl = fetchSpy.mock.calls[1][0] as string
    expect(lastCallUrl).toContain('window=7d')
  })

  it('re-fetches when mode changes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const { rerender } = renderHook(
      ({ mode }: { mode: 'combined' | 'hw' }) => useScop('30d', mode),
      { initialProps: { mode: 'combined' as 'combined' | 'hw' } },
    )

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    rerender({ mode: 'hw' })

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    const lastCallUrl = fetchSpy.mock.calls[1][0] as string
    expect(lastCallUrl).toContain('mode=hw')
  })

  it('cancels in-flight request on unmount', async () => {
    let resolveFetch: (value: Response) => void
    const fetchPromise = new Promise<Response>((res) => {
      resolveFetch = res
    })
    vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchPromise)

    const { result, unmount } = renderHook(() => useScop('30d', 'combined'))

    expect(result.current.loading).toBe(true)
    unmount()

    resolveFetch!({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    await new Promise((r) => setTimeout(r, 10))

    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
  })

  it('constructs ingress-aware URL via apiUrl()', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    renderHook(() => useScop('today', 'ch'))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl.startsWith('./')).toBe(true)
    expect(calledUrl).toContain('api/scop')
    expect(calledUrl).toContain('window=today')
    expect(calledUrl).toContain('mode=ch')
  })
})
