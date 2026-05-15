import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useEntityScan, useRoomEntityScan } from '../useEntityScan'

const MOCK_SCAN = {
  candidates: {
    hp_flow_temp: [
      {
        entity_id: 'sensor.hp_flow_temp',
        friendly_name: 'HP Flow Temp',
        score: 35,
        confidence: 'high' as const,
        state: '35.2',
        device_class: 'temperature',
        unit: '°C',
      },
    ],
  },
  total_entities: 100,
}

describe('useEntityScan', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('auto-scans on mount (INSTRUCTION-90C)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_SCAN,
    } as Response)

    const { result } = renderHook(() => useEntityScan())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toContain('api/wizard/scan-entities')
    expect(result.current.candidates.hp_flow_temp?.[0].confidence).toBe('high')
    expect(result.current.totalEntities).toBe(100)
  })

  it('refires fetch on component remount', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_SCAN,
    } as Response)

    const first = renderHook(() => useEntityScan())
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    first.unmount()

    const second = renderHook(() => useEntityScan())
    await waitFor(() => expect(second.result.current.loading).toBe(false))
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('refresh() forces a re-scan without remounting', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_SCAN,
    } as Response)

    const { result } = renderHook(() => useEntityScan())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.refresh()
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('autoScan:false skips mount-time fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_SCAN,
    } as Response)

    renderHook(() => useEntityScan({ autoScan: false }))

    // Allow any pending microtasks to flush
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('captures fetch error in state', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network down'))

    const { result } = renderHook(() => useEntityScan())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Network down')
  })
})

describe('useRoomEntityScan', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not auto-scan (room is provided by caller)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ room: 'lounge', candidates: {} }),
    } as Response)

    renderHook(() => useRoomEntityScan())
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('scanRoom populates roomCandidates', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        room: 'lounge',
        candidates: {
          trv_entity: [
            {
              entity_id: 'climate.lounge_trv',
              friendly_name: 'Lounge TRV',
              score: 30,
              confidence: 'high' as const,
              state: '20.5',
              device_class: '',
              unit: '',
            },
          ],
        },
      }),
    } as Response)

    const { result } = renderHook(() => useRoomEntityScan())

    await act(async () => {
      await result.current.scanRoom('lounge')
    })

    expect(result.current.roomCandidates.lounge?.trv_entity?.[0].entity_id).toBe(
      'climate.lounge_trv',
    )
  })
})


// =============================================================================
// INSTRUCTION-231D — heating_entity scored-list shape (post-231C scanner fix)
// =============================================================================


describe('INSTRUCTION-231D: heating_entity candidate list shape (post-231C scanner fix)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns sorted scored candidate list for heating_entity slot', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: {
          heating_entity: [
            {
              entity_id: 'sensor.bathroom_heating',
              friendly_name: 'Bathroom Heating',
              score: 40,
              confidence: 'high' as const,
              state: '29.0',
              device_class: '',
              unit: '',
            },
            {
              entity_id: 'number.bathroom_valve_position',
              friendly_name: 'Bathroom Valve',
              score: 32,
              confidence: 'medium' as const,
              state: '50',
              device_class: '',
              unit: '',
            },
          ],
        },
        total_entities: 50,
      }),
    } as Response)
    const { result } = renderHook(() => useEntityScan())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.candidates.heating_entity).toHaveLength(2)
    // Highest score first per the API contract.
    expect(result.current.candidates.heating_entity?.[0].entity_id).toBe(
      'sensor.bathroom_heating',
    )
    expect(result.current.candidates.heating_entity?.[0].score).toBeGreaterThan(
      result.current.candidates.heating_entity?.[1].score ?? 0,
    )
    fetchSpy.mockRestore()
  })

  it('returns empty array when scanner has no heating_entity candidates', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: {}, total_entities: 0 }),
    } as Response)
    const { result } = renderHook(() => useEntityScan())
    await waitFor(() => expect(result.current.loading).toBe(false))
    // The hook's contract: an absent slot key yields undefined or [].
    // Consumers can safely iterate via `?? []`.
    const heCands = result.current.candidates.heating_entity ?? []
    expect(Array.isArray(heCands)).toBe(true)
    expect(heCands.length).toBe(0)
    fetchSpy.mockRestore()
  })
})
