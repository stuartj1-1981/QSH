import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useManual } from '../useManual'
import type { ManualEntry } from '../../types/api'

const AUTO_ENTRY: ManualEntry = {
  room: 'lounge',
  mode: 'AUTO',
  position_pct: null,
  set_by: 'startup_default',
  set_at: 0,
  hardware_type: 'direct_type1',
}

const SECOND_ENTRY: ManualEntry = {
  room: 'bed1',
  mode: 'AUTO',
  position_pct: null,
  set_by: 'startup_default',
  set_at: 0,
  hardware_type: 'direct_type2',
}

const MANUAL_CONFIRMED: ManualEntry = {
  room: 'lounge',
  mode: 'MANUAL',
  position_pct: 65,
  set_by: 'engineering_ui',
  set_at: 1715600000,
  hardware_type: 'direct_type1',
}

function _mockOk<T>(body: T): Response {
  return { ok: true, json: async () => body } as Response
}

describe('useManual', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initial fetch populates entries', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(_mockOk([AUTO_ENTRY, SECOND_ENTRY]))

    const { result } = renderHook(() => useManual())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.entries).toHaveLength(2)
    expect(result.current.entries[0].room).toBe('lounge')
    expect(result.current.error).toBeNull()
  })

  it('fetch failure sets error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network down'))

    const { result } = renderHook(() => useManual())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Network down')
    expect(result.current.entries).toEqual([])
  })

  it('setManual optimistic then confirmed', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(_mockOk([AUTO_ENTRY]))
      .mockResolvedValueOnce(_mockOk(MANUAL_CONFIRMED))

    const { result } = renderHook(() => useManual())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.setManual('lounge', 65)
    })

    // Confirmed entry replaces the optimistic one.
    expect(result.current.entries[0]).toEqual(MANUAL_CONFIRMED)
    // Second call is the PUT.
    const putCall = fetchSpy.mock.calls[1]
    expect((putCall[0] as string)).toContain('api/manual/lounge')
    const opts = putCall[1] as RequestInit
    expect(opts.method).toBe('PUT')
    expect(JSON.parse(opts.body as string)).toEqual({
      mode: 'MANUAL',
      position_pct: 65,
      set_by: 'engineering_ui',
    })
  })

  it('setManual rolls back on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(_mockOk([AUTO_ENTRY]))
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ detail: 'invalid position' }),
      } as Response)

    const { result } = renderHook(() => useManual())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.setManual('lounge', 99)
    })

    // Rolled back to AUTO entry.
    expect(result.current.entries[0]).toEqual(AUTO_ENTRY)
    expect(result.current.error).toBe('invalid position')
  })

  it('setAuto calls DELETE', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(_mockOk([MANUAL_CONFIRMED]))
      .mockResolvedValueOnce(_mockOk({ ...AUTO_ENTRY, room: 'lounge' }))

    const { result } = renderHook(() => useManual())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.setAuto('lounge')
    })

    const deleteCall = fetchSpy.mock.calls[1]
    expect((deleteCall[0] as string)).toContain('api/manual/lounge')
    expect((deleteCall[1] as RequestInit).method).toBe('DELETE')
    expect(result.current.entries[0].mode).toBe('AUTO')
  })

  it('refresh replaces entries', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(_mockOk([AUTO_ENTRY]))
      .mockResolvedValueOnce(_mockOk([AUTO_ENTRY, SECOND_ENTRY]))

    const { result } = renderHook(() => useManual())
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.entries).toHaveLength(1)

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.entries).toHaveLength(2)
  })
})
