import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSwarm } from '../useSwarm'

const STATUS = {
  enabled: true,
  unit_id: 'urn:swarm:unit:stu-b27eb2c9',
  cohort_id: 'detached-2016',
  subscribe_enabled: false,
  endpoint: 'https://swarm.example.workers.dev',
  queue: { pending: 2, delivered: 5 },
  pending: 2,
}
const PRIORS = { families: {}, family_names: [], last_etag: null, count: 0 }
const DIVERGENCE = {
  rooms: [
    {
      room: 'lounge',
      u_shadow: 0.3, u_live: 0.28, u_delta: 0.02,
      c_shadow: 3.0, c_live: 2.5, c_delta: 0.5,
      solar_shadow: 0.5, solar_live: 0.45, solar_delta: 0.05,
    },
  ],
  counterfactual_summary: 'shadow leads live',
}
const GATES = {
  gates: {
    disturbance_relay: 'UNKNOWN',
    sysid_priors: 'UNKNOWN',
    solar_bootstrap: 'UNKNOWN',
    rl_benchmarking: 'UNKNOWN',
  },
}
const GLOBAL = {
  global_gate: 'OPEN',
  live_enabled: false,
  live_active: false,
  can_enable: true,
}
const CHANNELS = {
  channels: {
    disturbance_relay: { gate: 'UNKNOWN', family: null, data: 'none', wired: false },
    sysid_priors: { gate: 'OPEN', family: 'thermal_envelope', data: 'fresh', wired: true },
    solar_bootstrap: { gate: 'CLOSED', family: 'solar_capture', data: 'stale', wired: true },
    rl_benchmarking: { gate: 'UNKNOWN', family: null, data: 'none', wired: false },
  },
}

// Resolve a GET by URL suffix; the POST /api/swarm/live returns 200 {live_enabled}.
function mockFetchByUrl() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('live')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ live_enabled: true }) } as Response)
    }
    const body = url.endsWith('status')
      ? STATUS
      : url.endsWith('priors')
        ? PRIORS
        : url.endsWith('divergence')
          ? DIVERGENCE
          : url.endsWith('gates')
            ? GATES
            : url.endsWith('channels')
              ? CHANNELS
              : url.endsWith('global')
                ? GLOBAL
                : null
    return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response)
  })
}

describe('useSwarm', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the typed shapes for all endpoints on success', async () => {
    mockFetchByUrl()
    const { result } = renderHook(() => useSwarm())
    await waitFor(() => expect(result.current.status).not.toBeNull())
    await waitFor(() => expect(result.current.gates).not.toBeNull())

    expect(result.current.status?.unit_id).toBe('urn:swarm:unit:stu-b27eb2c9')
    expect(result.current.status?.pending).toBe(2)
    expect(result.current.status?.queue.delivered).toBe(5)
    expect(result.current.priors?.count).toBe(0)
    expect(result.current.divergence?.rooms[0].room).toBe('lounge')
    expect(result.current.divergence?.rooms[0].u_delta).toBeCloseTo(0.02)
    expect(result.current.gates?.gates.sysid_priors).toBe('UNKNOWN')
    expect(result.current.error).toBeNull()
  })

  it('fetches globalState from api/swarm/global', async () => {
    mockFetchByUrl()
    const { result } = renderHook(() => useSwarm())
    await waitFor(() => expect(result.current.globalState).not.toBeNull())
    expect(result.current.globalState?.global_gate).toBe('OPEN')
    expect(result.current.globalState?.can_enable).toBe(true)
    expect(result.current.globalState?.live_active).toBe(false)
  })

  it('fetches channels from api/swarm/channels with the four consumption channels', async () => {
    mockFetchByUrl()
    const { result } = renderHook(() => useSwarm())
    await waitFor(() => expect(result.current.channels).not.toBeNull())
    expect(Object.keys(result.current.channels!.channels)).toHaveLength(4)
    expect(result.current.channels!.channels.sysid_priors.data).toBe('fresh')
    expect(result.current.channels!.channels.sysid_priors.wired).toBe(true)
    expect(result.current.channels!.channels.rl_benchmarking.wired).toBe(false)
  })

  it('sets error when a fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useSwarm())
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toContain('boom')
  })

  it('builds every request URL via apiUrl (six GETs, ingress-relative)', async () => {
    const spy = mockFetchByUrl()
    renderHook(() => useSwarm())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(6))
    const urls = spy.mock.calls.map((c) => c[0])
    expect(urls).toContain('./api/swarm/status')
    expect(urls).toContain('./api/swarm/priors')
    expect(urls).toContain('./api/swarm/divergence')
    expect(urls).toContain('./api/swarm/gates')
    expect(urls).toContain('./api/swarm/global')
    expect(urls).toContain('./api/swarm/channels')
  })

  it('rejects a malformed /api/swarm/global payload — sets error, leaves globalState null (B-3)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.endsWith('status')
        ? STATUS
        : url.endsWith('priors')
          ? PRIORS
          : url.endsWith('divergence')
            ? DIVERGENCE
            : url.endsWith('gates')
              ? GATES
              : url.endsWith('global')
                ? { global_gate: 'OPEN', live_enabled: true, can_enable: true } // missing live_active
                : null
      return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response)
    })
    const { result } = renderHook(() => useSwarm())
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toContain('malformed')
    // NOT accepted as a falsy default — globalState stays null.
    expect(result.current.globalState).toBeNull()
  })

  it('setLive POSTs {enabled} to the ingress-correct api/swarm/live and refetches', async () => {
    const spy = mockFetchByUrl()
    const { result } = renderHook(() => useSwarm())
    await waitFor(() => expect(result.current.globalState).not.toBeNull())
    spy.mockClear() // drop the initial poll so we can see the POST + the refetch

    let res: { ok: boolean; status: number; detail: string | null } | undefined
    await act(async () => {
      res = await result.current.setLive(true)
    })

    const postCall = spy.mock.calls.find((c) => String(c[0]).endsWith('live'))
    expect(postCall).toBeDefined()
    expect(String(postCall![0])).toBe('./api/swarm/live')
    expect(postCall![1]?.method).toBe('POST')
    expect(JSON.parse(postCall![1]?.body as string)).toEqual({ enabled: true })
    expect(res).toEqual({ ok: true, status: 200, detail: null })
    // Refetch fired — the status GET was called again after the clear.
    expect(spy.mock.calls.some((c) => String(c[0]).endsWith('status'))).toBe(true)
  })

  it('setLive surfaces the 409 detail without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('live')) {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({ detail: 'cannot enable — GLOBAL gate is not Open' }),
        } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => GLOBAL } as Response)
    })
    const { result } = renderHook(() => useSwarm())
    let res: { ok: boolean; status: number; detail: string | null } | undefined
    await act(async () => {
      res = await result.current.setLive(true)
    })
    expect(res).toEqual({ ok: false, status: 409, detail: 'cannot enable — GLOBAL gate is not Open' })
  })

  it('setLive returns a structured failure on a network error (never throws)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useSwarm())
    let res: { ok: boolean; status: number; detail: string | null } | undefined
    await act(async () => {
      res = await result.current.setLive(true)
    })
    expect(res?.ok).toBe(false)
    expect(res?.status).toBe(0)
    expect(res?.detail).toContain('offline')
  })
})
