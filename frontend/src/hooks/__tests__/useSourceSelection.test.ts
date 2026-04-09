import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSourceSelection } from '../useSourceSelection'
import type { SourceSelectionState } from '../../types/api'

const MOCK_RESPONSE: SourceSelectionState = {
  active_source: 'heat_pump',
  mode: 'auto',
  preference: 0.7,
  sources: [
    {
      name: 'heat_pump',
      type: 'heat_pump',
      status: 'active',
      efficiency: 3.5,
      fuel_cost_per_kwh: 0.245,
      cost_per_kwh_thermal: 0.07,
      carbon_per_kwh_thermal: 0.04,
      score: 0.06,
      signal_quality: 'good',
    },
    {
      name: 'lpg_boiler',
      type: 'lpg_boiler',
      status: 'standby',
      efficiency: 0.89,
      fuel_cost_per_kwh: 0.065,
      cost_per_kwh_thermal: 0.073,
      carbon_per_kwh_thermal: 0.24,
      score: 0.07,
      signal_quality: 'good',
    },
  ],
  switch_count_today: 0,
  max_switches_per_day: 6,
  failover_active: false,
  last_switch_reason: 'auto',
}

describe('useSourceSelection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null data initially while loading', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useSourceSelection(undefined))
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
  })

  it('returns data after successful fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    const { result } = renderHook(() => useSourceSelection(undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).not.toBeNull()
    expect(result.current.data?.active_source).toBe('heat_pump')
    expect(result.current.data?.sources).toHaveLength(2)
  })

  it('returns error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response)

    const { result } = renderHook(() => useSourceSelection(undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('500')
  })

  it('updates data from live WebSocket prop', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_RESPONSE,
    } as Response)

    const live: SourceSelectionState = { ...MOCK_RESPONSE, active_source: 'lpg_boiler' }
    const { result, rerender } = renderHook(
      ({ liveProp }) => useSourceSelection(liveProp),
      { initialProps: { liveProp: undefined as SourceSelectionState | undefined } }
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ liveProp: live })
    expect(result.current.data?.active_source).toBe('lpg_boiler')
  })

  it('setMode calls correct API endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => MOCK_RESPONSE } as Response)

    const { result } = renderHook(() => useSourceSelection(undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))

    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ mode: 'lpg_boiler' }) } as Response)
    await act(async () => { await result.current.setMode('lpg_boiler') })

    const call = fetchSpy.mock.calls[1]
    expect(call[0]).toContain('api/source-selection/mode')
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ mode: 'lpg_boiler' })
  })

  it('setPreference calls correct API endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => MOCK_RESPONSE } as Response)

    const { result } = renderHook(() => useSourceSelection(undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))

    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ preference: 0.5 }) } as Response)
    await act(async () => { await result.current.setPreference(0.5) })

    const call = fetchSpy.mock.calls[1]
    expect(call[0]).toContain('api/source-selection/preference')
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ preference: 0.5 })
  })

  it('handles setMode API error gracefully', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => MOCK_RESPONSE } as Response)

    const { result } = renderHook(() => useSourceSelection(undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))

    fetchSpy.mockResolvedValueOnce({ ok: false, status: 400 } as Response)
    await act(async () => { await result.current.setMode('invalid') })

    expect(result.current.error).toBe('400')
  })
})
