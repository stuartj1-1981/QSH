import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useAwayState } from '../useAway'
import type { AwayStateResponse } from '../../types/schedule'

const VALID_RESPONSE: AwayStateResponse = {
  whole_house: { active: false, days: 0 },
  per_zone: {},
  recovery: { active: false, rooms: {} },
  operating_state: 'normal',
}

describe('useAwayState — INSTRUCTION-142 setup-mode hardening', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('happy path: stores valid AwayStateResponse and clears error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => VALID_RESPONSE,
    } as Response)

    const { result } = renderHook(() => useAwayState())

    await waitFor(() => {
      expect(result.current.data).not.toBeNull()
    })

    expect(result.current.data).toEqual(VALID_RESPONSE)
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('503 setup-mode response: data stays null, error is "503: Config not loaded"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'Config not loaded' }),
    } as Response)

    const { result } = renderHook(() => useAwayState())

    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })

    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('503: Config not loaded')
    expect(result.current.loading).toBe(false)
  })

  it('malformed 200 body missing per_zone: data stays null, error is shape error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        whole_house: { active: false, days: 0 },
        recovery: { active: false, rooms: {} },
        // per_zone intentionally absent
      }),
    } as Response)

    const { result } = renderHook(() => useAwayState())

    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })

    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('Unexpected /api/away response shape')
    expect(result.current.loading).toBe(false)
  })

  it('stale-while-error: prior data is retained when a subsequent fetch errors', async () => {
    const firstBody: AwayStateResponse = {
      whole_house: { active: true, days: 3 },
      per_zone: { lounge: {
        active: true,
        days: 3,
        is_persistent: false,
        computed_depth_c: 2.0,
        current_temp: 18.5,
        target_temp: 21.0,
        occupancy_state: 'unoccupied',
      } },
      recovery: { active: false, rooms: {} },
      operating_state: 'away',
    }

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => firstBody,
    } as Response)

    const { result } = renderHook(() => useAwayState())

    await waitFor(() => {
      expect(result.current.data).toEqual(firstBody)
    })

    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'Config not loaded' }),
    } as Response)

    await act(async () => {
      result.current.refetch()
    })

    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })

    expect(result.current.data).toEqual(firstBody)
    expect(result.current.loading).toBe(false)
  })
})
