import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSysid } from '../useSysid'

const _baseRooms = {
  lounge: {
    u_kw_per_c: 0.234,
    c_kwh_per_c: 2.5,
    u_observations: 50,
    c_observations: 30,
    c_source: 'cycle',
    pc_fits: 1,
    solar_gain: 0.12,
    confidence: 'medium',
  },
}

function _mockOk<T>(body: T): Response {
  return { ok: true, json: async () => body } as Response
}

describe('useSysid', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns rooms data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      _mockOk({ rooms: _baseRooms }),
    )
    const { result } = renderHook(() => useSysid())
    await waitFor(() => {
      expect(result.current.data).not.toBeNull()
    })
    expect(result.current.data?.rooms.lounge.u_kw_per_c).toBe(0.234)
  })

  it('exposes installation_solar_capacity_kw envelope (INSTRUCTION-227C Task 8)', async () => {
    // State 3 (immature) from the 227B four-state contract.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      _mockOk({
        rooms: _baseRooms,
        installation_solar_capacity_kw: {
          value: 3.2,
          observations: 12,
          mature: false,
          last_updated_ts: 1700000000.0,
        },
      }),
    )
    const { result } = renderHook(() => useSysid())
    await waitFor(() => {
      expect(result.current.data).not.toBeNull()
    })
    const cap = result.current.data?.installation_solar_capacity_kw
    expect(cap).toBeTruthy()
    expect(cap?.value).toBe(3.2)
    expect(cap?.observations).toBe(12)
    expect(cap?.mature).toBe(false)
  })

  it('handles legacy backend (no installation_solar_capacity_kw key)', async () => {
    // Pre-227B backend — key absent. Optional type → undefined OK.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      _mockOk({ rooms: _baseRooms }),
    )
    const { result } = renderHook(() => useSysid())
    await waitFor(() => {
      expect(result.current.data).not.toBeNull()
    })
    expect(result.current.data?.installation_solar_capacity_kw).toBeUndefined()
  })

  it('handles top-level-null state (sysid uninitialised)', async () => {
    // State 1 from the four-state contract: sysid is None → key is null.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      _mockOk({
        rooms: {},
        installation_solar_capacity_kw: null,
        error: 'SysID not yet initialised',
      }),
    )
    const { result } = renderHook(() => useSysid())
    await waitFor(() => {
      expect(result.current.data).not.toBeNull()
    })
    expect(result.current.data?.installation_solar_capacity_kw).toBeNull()
  })
})
