import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useApoptosis } from '../useApoptosis'

const _suspended = {
  known: true,
  hormesis: false,
  armed: true,
  suspended: true,
  enabled: true,
  trigger_a: true,
  trigger_b: true,
  trigger_c: true,
}

describe('useApoptosis', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the typed shape on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => _suspended,
    } as Response)
    const { result } = renderHook(() => useApoptosis())
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(result.current.data?.suspended).toBe(true)
    expect(result.current.data?.armed).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('sets error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useApoptosis())
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toContain('boom')
  })

  it('builds the request URL via apiUrl (ingress-relative)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => _suspended,
    } as Response)
    renderHook(() => useApoptosis())
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy).toHaveBeenCalledWith('./api/swarm/apoptosis')
  })
})

describe('useApoptosis dormancy fields (INSTRUCTION-322B)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('surfaces the dormancy/recovery fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...{
          known: true, hormesis: false, armed: false, suspended: false,
          enabled: true, trigger_a: false, trigger_b: false, trigger_c: false,
        },
        dormant: true,
        pre_shutdown_active: false,
        pre_shutdown_remaining_hours: null,
        recommissioning: false,
        swarm_state: 'senescent_dormant',
      }),
    } as Response)
    const { result } = renderHook(() => useApoptosis())
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(result.current.data?.dormant).toBe(true)
    expect(result.current.data?.swarm_state).toBe('senescent_dormant')
    expect(result.current.data?.recommissioning).toBe(false)
  })
})
