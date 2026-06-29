import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useConfig } from '../useConfig'

// useConfig fetches the PROCESSED config (api/config — DEFAULT_CONFIG merged),
// unlike useRawConfig which serves the sparse on-disk YAML (api/config/raw).
// It is the source for runtime-default keys such as flow_*_internal.

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useConfig — processed config (api/config)', () => {
  it('fetches api/config and exposes the merged-default keys', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ flow_min_internal: 25.0, flow_max_internal: 50.0 }),
    } as Response)

    const { result } = renderHook(() => useConfig())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Hits the processed endpoint, NOT api/config/raw.
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('api/config'))
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('api/config/raw'))
    expect(result.current.data?.flow_min_internal).toBe(25.0)
    expect(result.current.data?.flow_max_internal).toBe(50.0)
    expect(result.current.error).toBeNull()
  })

  it('surfaces an error and leaves data null on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response)

    const { result } = renderHook(() => useConfig())

    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })
    expect(result.current.data).toBeNull()
  })
})
