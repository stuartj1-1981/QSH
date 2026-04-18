import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useBuildingLayout } from '../useBuildingLayout'
import * as buildingLayout from '../../lib/buildingLayout'
import {
  MOCK_CONFIG,
  MOCK_CONFIG_NO_ENVELOPE,
  MOCK_CONFIG_EXTENDED,
} from './fixtures/buildingFixtures'

describe('useBuildingLayout', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initially returns loading: true, then loading: false after fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_CONFIG,
    } as Response)

    const { result } = renderHook(() => useBuildingLayout())
    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })

  it('returns solved layout and passes LayoutRoom records to solveLayout', async () => {
    const solveSpy = vi.spyOn(buildingLayout, 'solveLayout')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_CONFIG,
    } as Response)

    const { result } = renderHook(() => useBuildingLayout())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.layout).not.toBeNull()
    expect(result.current.hasEnvelopeData).toBe(true)
    expect(solveSpy).toHaveBeenCalledTimes(1)
    const passedRooms = solveSpy.mock.calls[0][0]
    // Only 2 of 3 rooms have envelope — utility must be excluded.
    expect(Object.keys(passedRooms).sort()).toEqual(['kitchen', 'lounge'])
    expect(passedRooms.lounge.area_m2).toBe(20)
    expect(passedRooms.lounge.ceiling_m).toBe(2.5)
    expect(passedRooms.lounge.floor).toBe(0)
  })

  it('returns error string when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useBuildingLayout())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Network error')
    expect(result.current.layout).toBeNull()
  })

  it('excludes rooms without envelope from the solver input', async () => {
    const solveSpy = vi.spyOn(buildingLayout, 'solveLayout')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_CONFIG,
    } as Response)

    const { result } = renderHook(() => useBuildingLayout())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const passedRooms = solveSpy.mock.calls[0][0]
    expect(Object.keys(passedRooms)).toHaveLength(2)
    expect(passedRooms.utility).toBeUndefined()
    expect(result.current.hasEnvelopeData).toBe(true)
  })

  it('returns hasEnvelopeData: false and layout: null when no room has envelope', async () => {
    const solveSpy = vi.spyOn(buildingLayout, 'solveLayout')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_CONFIG_NO_ENVELOPE,
    } as Response)

    const { result } = renderHook(() => useBuildingLayout())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.hasEnvelopeData).toBe(false)
    expect(result.current.layout).toBeNull()
    expect(solveSpy).not.toHaveBeenCalled()
  })

  it('does NOT re-run solveLayout on refetch with identical payload (content-hash memo)', async () => {
    const solveSpy = vi.spyOn(buildingLayout, 'solveLayout')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_CONFIG } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_CONFIG } as Response)

    const { result } = renderHook(() => useBuildingLayout())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(solveSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.refetch()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Payload content is identical — memo must prevent re-solve.
    expect(solveSpy).toHaveBeenCalledTimes(1)
  })

  it('preserves array face values through JSON round-trip', () => {
    const envelope = {
      ceiling: [
        { room: 'bed1', type: 'floor_ceiling' as const },
        { room: 'bed2', type: 'floor_ceiling' as const },
      ],
      north_wall: { room: 'hall', type: 'wall' as const },
      south_wall: 'external' as const,
    }
    const serialised = JSON.stringify(envelope)
    const parsed = JSON.parse(serialised)
    expect(parsed.ceiling).toEqual(envelope.ceiling)
    expect(parsed.ceiling).toHaveLength(2)
    expect(parsed.north_wall).toEqual(envelope.north_wall)
    expect(parsed.south_wall).toBe('external')
  })

  it('DOES re-run solveLayout on refetch when payload changes', async () => {
    const solveSpy = vi.spyOn(buildingLayout, 'solveLayout')
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_CONFIG } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_CONFIG_EXTENDED } as Response)

    const { result } = renderHook(() => useBuildingLayout())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(solveSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.refetch()
    })
    await waitFor(() => {
      expect(solveSpy).toHaveBeenCalledTimes(2)
    })
    const secondCall = solveSpy.mock.calls[1][0]
    expect(secondCall.bedroom).toBeDefined()
  })
})
