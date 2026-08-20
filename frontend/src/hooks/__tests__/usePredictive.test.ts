import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { usePredictive } from '../usePredictive'

const MOCK_REPORT = {
  rooms: {
    lounge: {
      predictive_enabled: true,
      sensor_class: 'motion' as const,
      licensed: true,
      counters: {
        pred_obs_total: 100,
        pred_obs_skipped_away: 5,
        pred_obs_skipped_fallback: 0,
        pred_obs_skipped_partial: 2,
        pred_slots_mature: 40,
        pred_windows_licensed: 3,
        hits: 2,
        false_preheats: 1,
        missed_arrivals: 0,
      },
      next_window: { start_ts: 1735689600, end_ts: 1735693200, confidence: 0.82 },
      active_hold: false,
    },
  },
  gate_stats: {
    pred_obs_total: 100,
    pred_obs_skipped_away: 5,
    pred_obs_skipped_fallback: 0,
    pred_obs_skipped_partial: 2,
    pred_slots_mature: 40,
    pred_windows_licensed: 3,
    hits: 2,
    false_preheats: 1,
    missed_arrivals: 0,
  },
}

const MOCK_RAW_CONFIG = {
  rooms: {
    lounge: { area_m2: 20, predictive_occupancy: true, occupancy_class: 'motion' },
    bedroom: { area_m2: 15, predictive_occupancy: false, occupancy_class: 'motion' },
  },
}

describe('usePredictive', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns data shape on success', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_REPORT } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_RAW_CONFIG } as Response)

    const { result } = renderHook(() => usePredictive())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).not.toBeNull()
    expect(result.current.data?.rooms.lounge.predictive_enabled).toBe(true)
    expect(result.current.data?.rooms.lounge.counters.hits).toBe(2)
    expect(result.current.data?.gate_stats.pred_obs_total).toBe(100)
    expect(result.current.error).toBeNull()
  })

  it('handles fetch failure state', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_RAW_CONFIG } as Response)

    const { result } = renderHook(() => usePredictive())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Network error')
  })

  it('builds the report URL via apiUrl()', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_REPORT } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_RAW_CONFIG } as Response)

    renderHook(() => usePredictive())

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    expect(fetchSpy.mock.calls[0][0]).toBe('./api/predictive')
  })

  it('setPredictiveEnabled reads rooms from config, flips the key, and PATCHes the whole rooms section', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_REPORT } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_RAW_CONFIG } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ updated: 'rooms', restart_required: true, message: 'Restart required' }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_RAW_CONFIG } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_REPORT } as Response)

    const { result } = renderHook(() => usePredictive())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.setPredictiveEnabled('bedroom', true)
    })

    const patchCall = fetchSpy.mock.calls[2]
    expect(patchCall[0]).toBe('./api/config/rooms')
    const opts = patchCall[1] as RequestInit
    expect(opts.method).toBe('PATCH')
    const body = JSON.parse(opts.body as string)
    expect(body.data.bedroom.predictive_occupancy).toBe(true)
    // Untouched room is carried through unchanged (whole-section write).
    expect(body.data.lounge.predictive_occupancy).toBe(true)

    await waitFor(() => {
      expect(result.current.restartNotice).toBe('Restart required')
    })
  })

  it('setPredictiveEnabled surfaces an error and does not fetch when the room is unknown', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_REPORT } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_RAW_CONFIG } as Response)

    const { result } = renderHook(() => usePredictive())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const callsBefore = fetchSpy.mock.calls.length
    await act(async () => {
      await result.current.setPredictiveEnabled('nonexistent_room', true)
    })

    expect(fetchSpy.mock.calls.length).toBe(callsBefore)
    expect(result.current.error).toContain('nonexistent_room')
  })
})
