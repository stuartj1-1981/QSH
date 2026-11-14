import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useEfficiencyEnvelope, resetEfficiencyEnvelope } from '../useEfficiencyEnvelope'
import type { EfficiencyEnvelopeResponse } from '../../types/api'

// INSTRUCTION-620B — the hook reads GET /api/envelope (INSTRUCTION-620A).

const BODY: EfficiencyEnvelopeResponse = {
  schema_version: 1,
  install_class: 'metered',
  power_entity: 'sensor.hp_power',
  heat_entity: 'sensor.hp_heat',
  cop_entity: '',
  samples: 221,
  refused: { not_in_heat: 259, settling: 44 },
  reference_input_kw: 1.45,
  s1: [],
  s1_mature: false,
  s2: [{ flow_c: 34, outdoor_c: 6, cop: 4.678, n: 134, mature: true }],
  s2_mature: false,
  floor: { mature: false, floor_fraction: null, floor_kw_el: null, floor_penalty: null },
  ceiling: [],
  updated_at: 1794330827.27,
}

describe('useEfficiencyEnvelope', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches the ingress-relative api/envelope URL', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      { ok: true, json: async () => BODY } as Response,
    )
    const { result } = renderHook(() => useEfficiencyEnvelope())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(spy).toHaveBeenCalledWith('./api/envelope')
  })

  it('returns the envelope on success and is loading until then', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      { ok: true, json: async () => BODY } as Response,
    )
    const { result } = renderHook(() => useEfficiencyEnvelope())
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.data?.samples).toBe(221)
    expect(result.current.data?.s2[0].cop).toBe(4.678)
  })

  it('reports a 503 with the backend detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'Efficiency envelope not yet initialised' }),
    } as Response)
    const { result } = renderHook(() => useEfficiencyEnvelope())
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toBe('HTTP 503 — Efficiency envelope not yet initialised')
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('reports the status line when the error body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async (): Promise<unknown> => {
        throw new SyntaxError('Unexpected token')
      },
    } as Response)
    const { result } = renderHook(() => useEfficiencyEnvelope())
    await waitFor(() => expect(result.current.error).toBe('HTTP 502'))
  })

  it('reports a network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Failed to fetch'))
    const { result } = renderHook(() => useEfficiencyEnvelope())
    await waitFor(() => expect(result.current.error).toBe('Failed to fetch'))
    expect(result.current.loading).toBe(false)
  })
})

describe('useEfficiencyEnvelope — polling', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  function okBody(samples: number): Response {
    return { ok: true, json: async () => ({ ...BODY, samples }) } as Response
  }

  it('reads again after each poll interval', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okBody(221))
      .mockResolvedValueOnce(okBody(223))
    const { result } = renderHook(() => useEfficiencyEnvelope(1000))
    await vi.waitFor(() => expect(result.current.data?.samples).toBe(221))
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(result.current.data?.samples).toBe(223))
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('does not read while the page is hidden', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okBody(221))
    const { result } = renderHook(() => useEfficiencyEnvelope(1000))
    await vi.waitFor(() => expect(result.current.data).not.toBeNull())
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await vi.advanceTimersByTimeAsync(3000)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('stops polling after unmount and leaves no timer', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okBody(221))
    const { result, unmount } = renderHook(() => useEfficiencyEnvelope(1000))
    await vi.waitFor(() => expect(result.current.data).not.toBeNull())
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(3000)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('keeps the last good data when a later read fails, and clears the error on the next good read', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okBody(221))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(okBody(225))
    const { result } = renderHook(() => useEfficiencyEnvelope(1000))
    await vi.waitFor(() => expect(result.current.data?.samples).toBe(221))
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(result.current.error).toBe('Failed to fetch'))
    expect(result.current.data?.samples).toBe(221)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(result.current.data?.samples).toBe(225))
    expect(result.current.error).toBeNull()
  })

  it('drops a read that refresh() overtook', async () => {
    let releaseOld: (r: Response) => void = () => {}
    vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(new Promise<Response>((res) => { releaseOld = res }))
      .mockResolvedValueOnce(okBody(0))
    const { result } = renderHook(() => useEfficiencyEnvelope())
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.data?.samples).toBe(0))
    await act(async () => { releaseOld(okBody(221)) })
    expect(result.current.data?.samples).toBe(0)
  })

  it('reads at once on refresh()', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okBody(221))
      .mockResolvedValueOnce(okBody(0))
    const { result } = renderHook(() => useEfficiencyEnvelope())
    await waitFor(() => expect(result.current.data?.samples).toBe(221))
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.data?.samples).toBe(0))
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('resetEfficiencyEnvelope', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts to the ingress-relative reset URL and returns the result', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'reset', install_class: 'metered', power_entity: 'sensor.hp_power' }),
    } as Response)
    const res = await resetEfficiencyEnvelope()
    expect(spy).toHaveBeenCalledWith('./api/envelope/reset', { method: 'POST' })
    expect(res).toEqual({
      ok: true,
      result: { status: 'reset', install_class: 'metered', power_entity: 'sensor.hp_power' },
    })
  })

  it('returns the 503 with the backend detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'Efficiency envelope not yet initialised' }),
    } as Response)
    expect(await resetEfficiencyEnvelope()).toEqual({
      ok: false,
      error: 'HTTP 503 — Efficiency envelope not yet initialised',
    })
  })

  it('returns a network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Failed to fetch'))
    expect(await resetEfficiencyEnvelope()).toEqual({ ok: false, error: 'Failed to fetch' })
  })
})
