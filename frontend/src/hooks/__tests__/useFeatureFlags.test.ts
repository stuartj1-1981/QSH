import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFeatureFlags } from '../useFeatureFlags'

const _ff_response = {
  master_enable: false,
  flags: {
    rl: { lounge: false, _global: false },
  },
  rooms: ['lounge'],
  deferred_enforcement_note: 'deferred...',
}

describe('useFeatureFlags', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data on happy path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => _ff_response,
    } as Response)
    const { result } = renderHook(() => useFeatureFlags())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data?.master_enable).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('returns error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'))
    const { result } = renderHook(() => useFeatureFlags())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toContain('network')
    expect(result.current.data).toBeNull()
  })

  it('returns error on non-2xx status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response)
    const { result } = renderHook(() => useFeatureFlags())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toContain('500')
  })

  it('starts loading=true initially', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {}),
    )
    const { result } = renderHook(() => useFeatureFlags())
    expect(result.current.loading).toBe(true)
  })

  it('aborts fetch on unmount', async () => {
    const abortFn = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_url, init) => {
      const sig = (init as RequestInit | undefined)?.signal as AbortSignal | undefined
      sig?.addEventListener('abort', abortFn)
      return new Promise(() => {}) as Promise<Response>
    })
    const { unmount } = renderHook(() => useFeatureFlags())
    unmount()
    await waitFor(() => expect(abortFn).toHaveBeenCalled())
  })
})
