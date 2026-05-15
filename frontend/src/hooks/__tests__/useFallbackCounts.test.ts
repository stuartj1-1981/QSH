import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFallbackCounts } from '../useFallbackCounts'

const _fc_response = {
  fallback_counts: { rl: 3, shoulder_controller: 1 },
}

describe('useFallbackCounts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data on happy path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => _fc_response,
    } as Response)
    const { result } = renderHook(() => useFallbackCounts())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data?.fallback_counts.rl).toBe(3)
  })

  it('returns error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useFallbackCounts())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toContain('boom')
  })

  it('starts loading=true initially', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {}),
    )
    const { result } = renderHook(() => useFallbackCounts())
    expect(result.current.loading).toBe(true)
  })

  it('aborts fetch on unmount', async () => {
    const abortFn = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_url, init) => {
      const sig = (init as RequestInit | undefined)?.signal as AbortSignal | undefined
      sig?.addEventListener('abort', abortFn)
      return new Promise(() => {}) as Promise<Response>
    })
    const { unmount } = renderHook(() => useFallbackCounts())
    unmount()
    await waitFor(() => expect(abortFn).toHaveBeenCalled())
  })
})
