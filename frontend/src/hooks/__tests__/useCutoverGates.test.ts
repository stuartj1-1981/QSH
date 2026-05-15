import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useCutoverGates } from '../useCutoverGates'

const _gates_response = {
  window_cycles: 168,
  cycles_required: 168,
  gates: {},
}

describe('useCutoverGates', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data on happy path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => _gates_response,
    } as Response)
    const { result } = renderHook(() => useCutoverGates())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data?.window_cycles).toBe(168)
    expect(result.current.error).toBeNull()
  })

  it('returns error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'))
    const { result } = renderHook(() => useCutoverGates())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toContain('network')
  })

  it('starts loading=true initially', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {}),
    )
    const { result } = renderHook(() => useCutoverGates())
    expect(result.current.loading).toBe(true)
  })

  it('aborts fetch on unmount', async () => {
    const abortFn = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_url, init) => {
      const sig = (init as RequestInit | undefined)?.signal as AbortSignal | undefined
      sig?.addEventListener('abort', abortFn)
      return new Promise(() => {}) as Promise<Response>
    })
    const { unmount } = renderHook(() => useCutoverGates())
    unmount()
    await waitFor(() => expect(abortFn).toHaveBeenCalled())
  })

  it('threads windowCycles into URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => _gates_response,
    } as Response)
    renderHook(() => useCutoverGates(336))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('window_cycles=336')
  })
})
