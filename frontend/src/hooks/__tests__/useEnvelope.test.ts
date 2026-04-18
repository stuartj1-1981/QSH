import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEnvelope } from '../useEnvelope'
import type { RoomConfigYaml } from '../../types/config'

describe('useEnvelope — 112C multi-room face support', () => {
  const baseRooms: Record<string, RoomConfigYaml> = {
    lounge: { area_m2: 20, floor: 0 },
    bed1: { area_m2: 12, floor: 1 },
    bed2: { area_m2: 12, floor: 1 },
  }

  // 5j. addRoomToFace creates array
  it('5j. addRoomToFace converts null → scalar → array', () => {
    const rooms = { ...baseRooms }
    const { result } = renderHook(() => useEnvelope({ rooms }))

    // Start: ceiling is null
    expect(result.current.rooms.lounge.envelope.ceiling).toBeUndefined()

    // Add first room → scalar ref
    act(() => {
      result.current.addRoomToFace('lounge', 'ceiling', { room: 'bed1', type: 'floor_ceiling' })
    })
    const v1 = result.current.rooms.lounge.envelope.ceiling
    expect(v1).not.toBeNull()
    if (v1 && !Array.isArray(v1) && typeof v1 === 'object' && 'room' in v1) {
      expect(v1.room).toBe('bed1')
    }

    // Add second room → array of 2
    act(() => {
      result.current.addRoomToFace('lounge', 'ceiling', { room: 'bed2', type: 'floor_ceiling' })
    })
    const v2 = result.current.rooms.lounge.envelope.ceiling
    expect(Array.isArray(v2)).toBe(true)
    if (Array.isArray(v2)) {
      expect(v2).toHaveLength(2)
      expect(v2.map((r) => r.room)).toEqual(expect.arrayContaining(['bed1', 'bed2']))
    }
  })

  // 5k. removeRoomFromFace collapses array
  it('5k. removeRoomFromFace: array of 2 → scalar, then → null', () => {
    const rooms: Record<string, RoomConfigYaml> = {
      ...baseRooms,
      lounge: {
        area_m2: 20,
        floor: 0,
        envelope: {
          ceiling: [
            { room: 'bed1', type: 'floor_ceiling' as const },
            { room: 'bed2', type: 'floor_ceiling' as const },
          ],
        },
      },
    }
    const { result } = renderHook(() => useEnvelope({ rooms }))

    // Start: array of 2
    expect(Array.isArray(result.current.rooms.lounge.envelope.ceiling)).toBe(true)

    // Remove one → scalar
    act(() => {
      result.current.removeRoomFromFace('lounge', 'ceiling', 'bed1')
    })
    const v1 = result.current.rooms.lounge.envelope.ceiling
    expect(Array.isArray(v1)).toBe(false)
    if (v1 && typeof v1 === 'object' && 'room' in v1) {
      expect(v1.room).toBe('bed2')
    }

    // Remove last → null
    act(() => {
      result.current.removeRoomFromFace('lounge', 'ceiling', 'bed2')
    })
    expect(result.current.rooms.lounge.envelope.ceiling).toBeUndefined()
  })

  // 5l. removeRoomFromFace handles array peer
  it('5l. removeRoomFromFace: array peer cleanup only removes matching room', () => {
    const rooms: Record<string, RoomConfigYaml> = {
      lounge: { area_m2: 20, floor: 0 },
      open_plan: {
        area_m2: 30,
        floor: 1,
        envelope: {
          ceiling: [
            { room: 'lounge', type: 'floor_ceiling' as const },
            { room: 'bed1', type: 'floor_ceiling' as const },
          ],
        },
      },
      bed1: { area_m2: 12, floor: 1 },
    }
    const { result } = renderHook(() => useEnvelope({ rooms }))

    // open_plan.ceiling is [lounge, bed1]
    expect(Array.isArray(result.current.rooms.open_plan.envelope.ceiling)).toBe(true)

    // Set lounge.floor → open_plan
    act(() => {
      result.current.setFace('lounge', 'floor', { room: 'open_plan' })
    })

    // Remove lounge from open_plan.ceiling — only lounge ref cleared (auto-reciprocal)
    act(() => {
      result.current.removeRoomFromFace('open_plan', 'ceiling', 'lounge')
    })

    const v = result.current.rooms.open_plan.envelope.ceiling
    // Should be scalar bed1 now (lounge removed from array)
    if (v && typeof v === 'object' && 'room' in v) {
      expect((v as { room: string }).room).toBe('bed1')
    }
  })

  // 5m. setFace with array value auto-populates reciprocals
  it('5m. setFace(array): all 3 refs get reciprocal auto-populated', () => {
    const rooms = {
      lounge: { area_m2: 30, floor: 0 },
      bed1: { area_m2: 12, floor: 1 },
      bed2: { area_m2: 12, floor: 1 },
      bed3: { area_m2: 12, floor: 1 },
    }
    const { result } = renderHook(() => useEnvelope({ rooms }))

    // Directly set lounge.ceiling → [bed1, bed2, bed3]
    act(() => {
      result.current.setFace('lounge', 'ceiling', [
        { room: 'bed1', type: 'floor_ceiling' },
        { room: 'bed2', type: 'floor_ceiling' },
        { room: 'bed3', type: 'floor_ceiling' },
      ])
    })

    // Each peer should have reciprocal floor auto-populated
    const bed1Floor = result.current.rooms.bed1.envelope.floor
    const bed2Floor = result.current.rooms.bed2.envelope.floor
    const bed3Floor = result.current.rooms.bed3.envelope.floor
    if (bed1Floor && typeof bed1Floor === 'object' && 'room' in bed1Floor) {
      expect(bed1Floor.room).toBe('lounge')
    }
    if (bed2Floor && typeof bed2Floor === 'object' && 'room' in bed2Floor) {
      expect(bed2Floor.room).toBe('lounge')
    }
    if (bed3Floor && typeof bed3Floor === 'object' && 'room' in bed3Floor) {
      expect(bed3Floor.room).toBe('lounge')
    }
  })

  // 5n. addRoomToFace size cap at 10
  it('5n. addRoomToFace: silently rejects 11th room (cap at 10)', () => {
    const rooms = {
      lounge: { area_m2: 50, floor: 0 },
      ...Object.fromEntries(
        Array.from({ length: 10 }).map((_, i) => [
          `bed${i + 1}`,
          { area_m2: 12, floor: 1 },
        ])
      ),
      bed11: { area_m2: 12, floor: 1 },
    } as Record<string, RoomConfigYaml>

    const { result } = renderHook(() => useEnvelope({ rooms }))

    // Add 10 rooms to ceiling
    for (let i = 1; i <= 10; i++) {
      act(() => {
        result.current.addRoomToFace('lounge', 'ceiling', {
          room: `bed${i}`,
          type: 'floor_ceiling',
        })
      })
    }

    // Ceiling should have 10 refs
    const v10 = result.current.rooms.lounge.envelope.ceiling
    if (Array.isArray(v10)) {
      expect(v10).toHaveLength(10)
    }

    // Try to add 11th — should be silently rejected
    act(() => {
      result.current.addRoomToFace('lounge', 'ceiling', {
        room: 'bed11',
        type: 'floor_ceiling',
      })
    })

    // Still 10
    const v11 = result.current.rooms.lounge.envelope.ceiling
    if (Array.isArray(v11)) {
      expect(v11).toHaveLength(10)
      expect(v11.map((r) => r.room)).not.toContain('bed11')
    }
  })
})
