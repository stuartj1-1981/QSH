/** INSTRUCTION-524B T6(b) — the setup hook. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useHistorianSetup } from '../useHistorianSetup'
import { apiUrl } from '../../lib/api'

const BODY = {
  store_available: true,
  store_record: false,
  record_state: null,
  historian: true,
  store_open: false,
  active: false,
  backend_config: 'influxdb',
  backend_effective: null,
  enabled: false,
}

function okOnce(body: unknown = BODY) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useHistorianSetup', () => {
  it('fetches the setup route on mount and exposes the data', async () => {
    const fetchMock = okOnce()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useHistorianSetup())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual(BODY)
    expect(result.current.error).toBeNull()
  })

  it('uses apiUrl("api/historian/setup")', async () => {
    const fetchMock = okOnce()
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useHistorianSetup())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe(apiUrl('api/historian/setup'))
  })

  it('is loading before the response resolves', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))

    const { result } = renderHook(() => useHistorianSetup())

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
  })

  it('reports an error on a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    )

    const { result } = renderHook(() => useHistorianSetup())

    await waitFor(() => expect(result.current.error).toBe('HTTP 503'))
    expect(result.current.data).toBeNull()
  })

  it('reports an error on a rejected fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const { result } = renderHook(() => useHistorianSetup())

    await waitFor(() => expect(result.current.error).toBe('offline'))
  })

  it('refresh() re-reads the route', async () => {
    const fetchMock = okOnce()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useHistorianSetup())
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.refresh())

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('fetchNow() resolves to fresh data and stores it', async () => {
    const fresh = { ...BODY, record_state: 'shadow' as const }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => BODY })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => fresh })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useHistorianSetup())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let returned: unknown
    await act(async () => {
      returned = await result.current.fetchNow()
    })

    expect(returned).toEqual(fresh)
    expect(result.current.data).toEqual(fresh)
  })

  it('fetchNow() resolves null on failure, so the caller writes nothing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => BODY })
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useHistorianSetup())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let returned: unknown = 'unset'
    await act(async () => {
      returned = await result.current.fetchNow()
    })

    expect(returned).toBeNull()
  })

  it('does not poll', async () => {
    vi.useFakeTimers()
    const fetchMock = okOnce()
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useHistorianSetup())
    await vi.advanceTimersByTimeAsync(120_000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
