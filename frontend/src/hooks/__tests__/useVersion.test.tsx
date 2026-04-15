import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useVersion } from '../useVersion'

vi.mock('../../lib/api', () => ({
  apiUrl: (path: string) => `./${path.replace(/^\//, '')}`,
}))

describe('useVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the addon_version from /api/health', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'ok',
        pipeline_age_seconds: 10,
        cycle_number: 1,
        api_version: '0.1.0',
        addon_version: '1.1.11',
        driver: { status: 'connected' },
      }),
    } as Response)

    const { result } = renderHook(() => useVersion())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.version).toBe('1.1.11')
  })

  it('returns null version when the fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useVersion())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.version).toBeNull()
  })

  it('calls fetch with the apiUrl-resolved /api/health endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'ok',
        pipeline_age_seconds: 0,
        cycle_number: 0,
        api_version: '0.1.0',
        addon_version: '1.1.11',
        driver: { status: 'connected' },
      }),
    } as Response)

    const { result } = renderHook(() => useVersion())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(fetchSpy).toHaveBeenCalled()
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toBe('./api/health')
  })
})
