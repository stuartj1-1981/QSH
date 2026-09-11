import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useStoreStats, useSealedDays, useParity, useStoreConfig, useCutover, useStoreSql } from '../useStore'

const STORE_RESPONSE_BACKFILL = {
  historian: true,
  store: true,
  stats: {
    migration_state: 'backfill',
    backfill_state: 'pulling',
    backend_config: 'qsdb',
    backend_effective: 'influxdb',
    population_days: 10,
    reconciled_days: 4,
    unreconciled_days: 6,
    source_ok: true,
    source_last_error: null,
    last_pulled_day: '2026-09-01',
  },
}

const STORE_RESPONSE_CUTOVER = {
  historian: true,
  store: true,
  stats: {
    migration_state: 'cutover',
    backfill_state: null,
    backend_config: 'qsdb',
    backend_effective: 'qsdb',
    population_days: null,
    reconciled_days: null,
    unreconciled_days: null,
    source_ok: null,
    source_last_error: null,
    last_pulled_day: null,
  },
}

const DAYS_RESPONSE = {
  historian: true,
  store: true,
  days: [{ measurement: 'qsh_system', day: '2026-09-01', location: 'local', path: '/x', cache_path: null, rows: 100, sha256: 'abc' }],
  total: 1,
  truncated: false,
}

const PARITY_INDEX_RESPONSE = {
  historian: true,
  store: true,
  days: ['2026-09-01'],
}

describe('useStoreStats', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns data shape on the happy path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => STORE_RESPONSE_BACKFILL,
    } as Response)

    const { result } = renderHook(() => useStoreStats())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data?.stats?.migration_state).toBe('backfill')
    expect(result.current.error).toBeNull()
  })

  it('sets error and clears loading on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useStoreStats())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('network down')
  })

  it('uses apiUrl() for the /store endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => STORE_RESPONSE_CUTOVER,
    } as Response)

    renderHook(() => useStoreStats())
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('api/historian/store')
  })

  it('polls every 10s while migration_state is backfill', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => STORE_RESPONSE_BACKFILL,
    } as Response)

    renderHook(() => useStoreStats())
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('polls every 60s once the migration has cut over', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => STORE_RESPONSE_CUTOVER,
    } as Response)

    renderHook(() => useStoreStats())
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))

    // Not yet at the 60s slow-poll boundary.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50_000)
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('aborts the in-flight fetch on unmount and issues no further setState', async () => {
    const abortFn = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const sig = (init as RequestInit | undefined)?.signal as AbortSignal | undefined
      sig?.addEventListener('abort', abortFn)
      return new Promise(() => {}) as Promise<Response>
    })

    const { unmount } = renderHook(() => useStoreStats())
    unmount()
    await waitFor(() => expect(abortFn).toHaveBeenCalled())
  })
})

describe('useSealedDays', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data shape on the happy path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => DAYS_RESPONSE,
    } as Response)

    const { result } = renderHook(() => useSealedDays())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data?.total).toBe(1)
    expect(result.current.data?.days[0].measurement).toBe('qsh_system')
  })

  it('sets error and clears loading on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('boom'))

    const { result } = renderHook(() => useSealedDays())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('boom')
  })

  it('uses apiUrl() for the /days endpoint and threads offset/limit', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => DAYS_RESPONSE,
    } as Response)

    renderHook(() => useSealedDays('qsh_room', 50, 100))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('api/historian/days')
    expect(url).toContain('limit=50')
    expect(url).toContain('offset=100')
    expect(url).toContain('measurement=qsh_room')
  })

  it('aborts the in-flight fetch on unmount', async () => {
    const abortFn = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_url, init) => {
      const sig = (init as RequestInit | undefined)?.signal as AbortSignal | undefined
      sig?.addEventListener('abort', abortFn)
      return new Promise(() => {}) as Promise<Response>
    })

    const { unmount } = renderHook(() => useSealedDays())
    unmount()
    await waitFor(() => expect(abortFn).toHaveBeenCalled())
  })
})

describe('useParity', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the index shape on the happy path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => PARITY_INDEX_RESPONSE,
    } as Response)

    const { result } = renderHook(() => useParity())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.index?.days).toEqual(['2026-09-01'])
  })

  it('sets error and clears loading on index fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('boom'))

    const { result } = renderHook(() => useParity())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('boom')
  })

  it('uses apiUrl() for the /parity endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => PARITY_INDEX_RESPONSE,
    } as Response)

    renderHook(() => useParity())
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('api/historian/parity')
  })

  it('loadDay resolves a typed notFound on 404, not an error string', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => PARITY_INDEX_RESPONSE } as Response)
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) } as Response)

    const { result } = renderHook(() => useParity())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const dayResult = await result.current.loadDay('2026-09-02')
    expect(dayResult.kind).toBe('notFound')
  })

  it('loadDay resolves the report on success', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => PARITY_INDEX_RESPONSE } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ historian: true, store: true, day: '2026-09-01', report: { generated_at: 'x', comparisons: [] } }),
      } as Response)

    const { result } = renderHook(() => useParity())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const dayResult = await result.current.loadDay('2026-09-01')
    expect(dayResult.kind).toBe('ok')
    if (dayResult.kind === 'ok') {
      expect(dayResult.report.generated_at).toBe('x')
    }
  })
})

const HISTORIAN_SECTION = {
  enabled: true,
  host: 'a0d7b954-influxdb',
  port: 8086,
  database: 'qsh',
  username: 'qsh',
  password: '***REDACTED***',
  store: {
    shadow: true,
    cutover: 'manual',
    cutover_force: false,
    retention_days: 10,
    local_cache_days: 20,
    external_path: '/share/qsdb',
    parity_report: false,
  },
}

describe('useStoreConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockRouter(patchResult: unknown = { updated: 'historian', restart_required: true, message: 'ok' }) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init as RequestInit | undefined)?.method ?? 'GET'
      if (url.includes('config/raw') && method === 'GET') {
        return { ok: true, json: async () => ({ historian: HISTORIAN_SECTION }) } as Response
      }
      if (url.includes('config/historian') && method === 'PATCH') {
        return { ok: true, json: async () => patchResult } as Response
      }
      throw new Error(`unexpected fetch: ${method} ${url}`)
    })
  }

  it('the whole-section case (OB-6): PATCH body key set equals the loaded section, store carries all seven keys', async () => {
    const fetchSpy = mockRouter()
    const { result } = renderHook(() => useStoreConfig())

    await waitFor(() => expect(result.current.loading).toBe(false))

    let ok = false
    await act(async () => {
      ok = await result.current.save({ retention_days: 99 })
    })
    expect(ok).toBe(true)

    const patchCall = fetchSpy.mock.calls.find(
      (c) => String(c[0]).includes('config/historian') && (c[1] as RequestInit).method === 'PATCH',
    )
    expect(patchCall).toBeDefined()
    const sentBody = JSON.parse((patchCall![1] as RequestInit).body as string)
    const sentSection = sentBody.data

    // Key-set equality, not merely presence of the edited key — a test
    // asserting only that retention_days arrived would pass while the
    // panel deleted the InfluxDB host.
    expect(new Set(Object.keys(sentSection))).toEqual(new Set(Object.keys(HISTORIAN_SECTION)))
    expect(new Set(Object.keys(sentSection.store))).toEqual(new Set(Object.keys(HISTORIAN_SECTION.store)))
    expect(sentSection.store.retention_days).toBe(99)
    expect(sentSection.store.shadow).toBe(true)
    expect(sentSection.store.external_path).toBe('/share/qsdb')
    expect(sentSection.host).toBe('a0d7b954-influxdb')
  })

  it('the redaction round-trip (OB-3): a redacted password is sent back unchanged, never as an empty string', async () => {
    const fetchSpy = mockRouter()
    const { result } = renderHook(() => useStoreConfig())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.save({ parity_report: true })
    })

    const patchCall = fetchSpy.mock.calls.find(
      (c) => String(c[0]).includes('config/historian') && (c[1] as RequestInit).method === 'PATCH',
    )
    const sentBody = JSON.parse((patchCall![1] as RequestInit).body as string)
    expect(sentBody.data.password).toBe('***REDACTED***')
    expect(sentBody.data.password).not.toBe('')
  })

  it('save refuses when the section has not loaded', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useStoreConfig())

    expect(result.current.data).toBeNull()

    let ok = true
    await act(async () => {
      ok = await result.current.save({ retention_days: 5 })
    })
    expect(ok).toBe(false)
    expect(result.current.error).toMatch(/has not loaded/)
  })
})

describe('useCutover', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('always sends {} as the body — OB-1', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ state: 'cutover', gap_days: 0, forced: false }),
    } as Response)

    const { result } = renderHook(() => useCutover())
    await act(async () => {
      await result.current.request()
    })

    const call = fetchSpy.mock.calls[0]
    expect(String(call[0])).toContain('api/historian/migration/cutover')
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body).toEqual({})
    expect(Object.prototype.hasOwnProperty.call(body, 'force')).toBe(false)
  })

  it('maps a 409 to a typed refused outcome carrying unreconciled_days and source_last_error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: { unreconciled_days: 7, source_last_error: 'connection refused' } }),
    } as Response)

    const { result } = renderHook(() => useCutover())
    let outcome
    await act(async () => {
      outcome = await result.current.request()
    })
    expect(outcome).toEqual({
      kind: 'refused',
      unreconciled_days: 7,
      source_last_error: 'connection refused',
    })
  })
})

describe('useStoreSql', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends { q: sql } and returns the ok outcome on 200', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ columns: ['a'], rows: [[1]], row_count: 1, truncated: false, elapsed_ms: 3 }),
    } as Response)

    const { result } = renderHook(() => useStoreSql())
    await act(async () => {
      await result.current.run('SELECT 1')
    })

    const call = fetchSpy.mock.calls[0]
    expect(String(call[0])).toContain('api/historian/sql')
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ q: 'SELECT 1' })
    expect(result.current.outcome?.kind).toBe('ok')
  })

  it('maps 400/429/504 to three distinct outcome kinds', async () => {
    const cases: [number, string][] = [
      [400, 'badRequest'],
      [429, 'busy'],
      [504, 'timeout'],
    ]
    for (const [status, kind] of cases) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status,
        json: async () => ({ error: `err-${status}` }),
      } as Response)
      const { result } = renderHook(() => useStoreSql())
      await act(async () => {
        await result.current.run('SELECT 1')
      })
      expect(result.current.outcome?.kind).toBe(kind)
      vi.restoreAllMocks()
    }
  })
})
