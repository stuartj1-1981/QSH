import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useEnvelope } from '../hooks/useEnvelope'
import type { RoomConfigYaml } from '../types/config'

function makeRooms(): Record<string, RoomConfigYaml> {
  return {
    lounge: {
      area_m2: 20,
      facing: 'S',
      ceiling_m: 2.4,
      floor: 0,
      envelope: {
        north_wall: 'external',
        south_wall: { room: 'hall', type: 'wall' },
      },
    },
    hall: {
      area_m2: 8,
      facing: 'N',
      ceiling_m: 2.4,
      floor: 0,
      envelope: {
        north_wall: { room: 'lounge', type: 'wall' },
      },
    },
    bed1: {
      area_m2: 15,
      facing: 'S',
      ceiling_m: 2.4,
      floor: 1,
    },
    open_plan: {
      area_m2: 30,
      facing: 'interior',
      ceiling_m: 2.4,
      floor: 0,
    },
  }
}

describe('useEnvelope', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('1. loads initial state from config', () => {
    const rooms = makeRooms()
    const { result } = renderHook(() => useEnvelope({ rooms }))

    expect(result.current.rooms.lounge.floor).toBe(0)
    expect(result.current.rooms.lounge.envelope.north_wall).toBe('external')
    expect(result.current.rooms.lounge.envelope.south_wall).toEqual({
      room: 'hall',
      type: 'wall',
    })
    expect(result.current.rooms.bed1.envelope).toEqual({})
    expect(result.current.rooms.bed1.floor).toBe(1)
  })

  it('2. initial state with no envelope shows empty envelope', () => {
    const rooms: Record<string, RoomConfigYaml> = {
      roomA: { area_m2: 10 },
    }
    const { result } = renderHook(() => useEnvelope({ rooms }))
    expect(result.current.rooms.roomA.floor).toBeNull()
    expect(result.current.rooms.roomA.envelope).toEqual({})
  })

  it('3. setFloor updates correctly', () => {
    const rooms = makeRooms()
    const { result } = renderHook(() => useEnvelope({ rooms }))

    act(() => {
      result.current.setFloor('bed1', 2)
    })
    expect(result.current.rooms.bed1.floor).toBe(2)
    expect(result.current.dirty).toBe(true)
  })

  it('4. setFace to external literal', () => {
    const rooms = makeRooms()
    const { result } = renderHook(() => useEnvelope({ rooms }))

    act(() => {
      result.current.setFace('bed1', 'north_wall', 'external')
    })
    expect(result.current.rooms.bed1.envelope.north_wall).toBe('external')
  })

  it('5. setFace to another room defaults type=wall for same-floor wall', () => {
    const rooms = makeRooms()
    const { result } = renderHook(() => useEnvelope({ rooms }))

    act(() => {
      result.current.setFace('lounge', 'east_wall', { room: 'open_plan' })
    })
    expect(result.current.rooms.lounge.envelope.east_wall).toEqual({
      room: 'open_plan',
      type: 'wall',
    })
  })

  it('6. auto-symmetry: ceiling → floor on peer', () => {
    const rooms = makeRooms()
    const { result } = renderHook(() => useEnvelope({ rooms }))

    act(() => {
      result.current.setFace('lounge', 'ceiling', { room: 'bed1' })
    })
    expect(result.current.rooms.lounge.envelope.ceiling).toEqual({
      room: 'bed1',
      type: 'floor_ceiling',
    })
    expect(result.current.rooms.bed1.envelope.floor).toEqual({
      room: 'lounge',
      type: 'floor_ceiling',
    })
    expect(result.current.isAutoSet('bed1', 'floor')).toBe(true)
    expect(result.current.isAutoSet('lounge', 'ceiling')).toBe(false)
  })

  it('7. auto-symmetry: wall pair picks compass reciprocal', () => {
    const rooms = makeRooms()
    const { result } = renderHook(() => useEnvelope({ rooms }))

    act(() => {
      result.current.setFace('lounge', 'west_wall', { room: 'open_plan' })
    })
    // west_wall on lounge → east_wall on open_plan is the reciprocal
    expect(result.current.rooms.open_plan.envelope.east_wall).toEqual({
      room: 'lounge',
      type: 'wall',
    })
    expect(result.current.isAutoSet('open_plan', 'east_wall')).toBe(true)
  })

  it('8. auto-inference: same floor connection → wall', () => {
    const rooms = makeRooms()
    const { result } = renderHook(() => useEnvelope({ rooms }))

    act(() => {
      result.current.setFace('lounge', 'east_wall', { room: 'open_plan' })
    })
    const v = result.current.rooms.lounge.envelope.east_wall
    expect(v).toEqual({ room: 'open_plan', type: 'wall' })
  })

  it('9. auto-inference: ceiling/floor connection always floor_ceiling', () => {
    const rooms = makeRooms()
    const { result } = renderHook(() => useEnvelope({ rooms }))

    act(() => {
      result.current.setFace('lounge', 'ceiling', { room: 'bed1' })
    })
    const v = result.current.rooms.lounge.envelope.ceiling
    expect(v).toEqual({ room: 'bed1', type: 'floor_ceiling' })

    act(() => {
      result.current.setFace('bed1', 'floor', { room: 'lounge' })
    })
    expect(result.current.rooms.bed1.envelope.floor).toEqual({
      room: 'lounge',
      type: 'floor_ceiling',
    })
  })

  it('10. dirty tracking: clean → dirty on change → clean after save', async () => {
    const rooms = makeRooms()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ updated: ['lounge'], warnings: [], restart_required: true }),
    } as Response)

    const { result } = renderHook(() => useEnvelope({ rooms }))
    expect(result.current.dirty).toBe(false)

    act(() => {
      result.current.setFace('lounge', 'east_wall', 'external')
    })
    expect(result.current.dirty).toBe(true)

    await act(async () => {
      await result.current.save()
    })
    await waitFor(() => expect(result.current.dirty).toBe(false))
  })

  it('11. save calls PATCH /api/rooms/envelope with full topology', async () => {
    const rooms = makeRooms()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ updated: ['lounge'], warnings: [], restart_required: true }),
      } as Response)

    const { result } = renderHook(() => useEnvelope({ rooms }))

    act(() => {
      result.current.setFace('lounge', 'east_wall', 'external')
    })
    await act(async () => {
      await result.current.save()
    })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, opts] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain('api/rooms/envelope')
    expect((opts as RequestInit).method).toBe('PATCH')
    const body = JSON.parse((opts as RequestInit).body as string)
    expect(body.rooms.lounge).toBeDefined()
    expect(body.rooms.lounge.floor).toBe(0)
    expect(body.rooms.lounge.envelope.east_wall).toBe('external')
    // Unchanged rooms are still sent — backend handles idempotency
    expect(body.rooms.bed1).toBeDefined()
  })
})
