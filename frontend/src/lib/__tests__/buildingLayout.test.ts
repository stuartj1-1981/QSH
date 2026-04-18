import { describe, it, expect } from 'vitest'
import { solveLayout, type LayoutRoom, type SolvedRoom } from '../buildingLayout'

/** Helper: build a minimal LayoutRoom with sensible defaults. */
function room(
  area: number,
  floor: number,
  envelope: LayoutRoom['envelope'] = {},
): LayoutRoom {
  return { area_m2: area, ceiling_m: 2.4, floor, envelope }
}

/** Rectangles overlap iff they intersect on both axes (open intervals). */
function overlaps(a: SolvedRoom, b: SolvedRoom): boolean {
  const eps = 1e-6
  const xOverlap = a.x + a.w > b.x + eps && b.x + b.w > a.x + eps
  const zOverlap = a.z + a.d > b.z + eps && b.z + b.d > a.z + eps
  return xOverlap && zOverlap
}

describe('solveLayout', () => {
  it('1. places a single room at the origin with finite extents', () => {
    const out = solveLayout({
      only: room(25, 0, {
        north_wall: 'external',
        south_wall: 'external',
        east_wall: 'external',
        west_wall: 'external',
        floor: 'ground',
        ceiling: 'roof',
      }),
    })
    expect(Object.keys(out.rooms)).toEqual(['only'])
    const r = out.rooms.only
    expect(r.floor).toBe(0)
    expect(r.col).toBe(0)
    expect(r.row).toBe(0)
    expect(r.x).toBe(0)
    expect(r.z).toBe(0)
    expect(r.w).toBeGreaterThan(0)
    expect(r.d).toBeGreaterThan(0)
    expect(out.buildingWidth).toBeGreaterThan(0)
    expect(out.floorCount).toBe(1)
  })

  it('2. places two east-west adjacent rooms side by side without overlap', () => {
    const out = solveLayout({
      A: room(20, 0, {
        east_wall: { room: 'B' },
        north_wall: 'external',
        south_wall: 'external',
        west_wall: 'external',
      }),
      B: room(18, 0, {
        west_wall: { room: 'A' },
        north_wall: 'external',
        south_wall: 'external',
        east_wall: 'external',
      }),
    })
    const a = out.rooms.A
    const b = out.rooms.B
    expect(a.row).toBe(b.row)
    expect(b.col).toBeGreaterThan(a.col)
    expect(b.x).toBeGreaterThan(a.x)
    expect(overlaps(a, b)).toBe(false)
  })

  it('3. L-shaped adjacency produces higher col east and higher row south', () => {
    const out = solveLayout({
      A: room(20, 0, {
        east_wall: { room: 'B' },
        south_wall: { room: 'C' },
        north_wall: 'external',
        west_wall: 'external',
      }),
      B: room(12, 0, {
        west_wall: { room: 'A' },
        north_wall: 'external',
        south_wall: 'external',
        east_wall: 'external',
      }),
      C: room(14, 0, {
        north_wall: { room: 'A' },
        south_wall: 'external',
        east_wall: 'external',
        west_wall: 'external',
      }),
    })
    const { A, B, C } = out.rooms
    expect(B.col).toBeGreaterThan(A.col)
    expect(C.row).toBeGreaterThan(A.row)
    expect(overlaps(A, B)).toBe(false)
    expect(overlaps(A, C)).toBe(false)
    expect(overlaps(B, C)).toBe(false)
  })

  it('4. a sole ceiling/floor anchor aligns the two centres within 0.5m', () => {
    const out = solveLayout({
      A: room(20, 0, {
        ceiling: { room: 'B', type: 'floor_ceiling' },
        floor: 'ground',
        north_wall: 'external',
        south_wall: 'external',
        east_wall: 'external',
        west_wall: 'external',
      }),
      B: room(15, 1, {
        floor: { room: 'A', type: 'floor_ceiling' },
        ceiling: 'roof',
        north_wall: 'external',
        south_wall: 'external',
        east_wall: 'external',
        west_wall: 'external',
      }),
    })
    const a = out.rooms.A
    const b = out.rooms.B
    const aCx = a.x + a.w / 2
    const aCz = a.z + a.d / 2
    const bCx = b.x + b.w / 2
    const bCz = b.z + b.d / 2
    expect(Math.abs(aCx - bCx)).toBeLessThan(0.5)
    expect(Math.abs(aCz - bCz)).toBeLessThan(0.5)
  })

  it('5. synthetic 8-room 2-floor layout: no orphans, no same-floor overlaps', () => {
    // Ground floor: 2x2 grid  g00 g01
    //                         g10 g11
    // First floor:  2x2 grid  f00 f01
    //                         f10 f11
    // Anchors: g00↔f00 ceiling, g11↔f11 ceiling.
    const rooms: Record<string, LayoutRoom> = {
      g00: room(22, 0, {
        east_wall: { room: 'g01' },
        south_wall: { room: 'g10' },
        north_wall: 'external',
        west_wall: 'external',
        ceiling: { room: 'f00', type: 'floor_ceiling' },
        floor: 'ground',
      }),
      g01: room(15, 0, {
        west_wall: { room: 'g00' },
        south_wall: { room: 'g11' },
        north_wall: 'external',
        east_wall: 'external',
        floor: 'ground',
      }),
      g10: room(14, 0, {
        north_wall: { room: 'g00' },
        east_wall: { room: 'g11' },
        south_wall: 'external',
        west_wall: 'external',
        floor: 'ground',
      }),
      g11: room(16, 0, {
        north_wall: { room: 'g01' },
        west_wall: { room: 'g10' },
        south_wall: 'external',
        east_wall: 'external',
        ceiling: { room: 'f11', type: 'floor_ceiling' },
        floor: 'ground',
      }),
      f00: room(20, 1, {
        east_wall: { room: 'f01' },
        south_wall: { room: 'f10' },
        north_wall: 'external',
        west_wall: 'external',
        floor: { room: 'g00', type: 'floor_ceiling' },
        ceiling: 'roof',
      }),
      f01: room(12, 1, {
        west_wall: { room: 'f00' },
        south_wall: { room: 'f11' },
        north_wall: 'external',
        east_wall: 'external',
        ceiling: 'roof',
      }),
      f10: room(13, 1, {
        north_wall: { room: 'f00' },
        east_wall: { room: 'f11' },
        south_wall: 'external',
        west_wall: 'external',
        ceiling: 'roof',
      }),
      f11: room(14, 1, {
        north_wall: { room: 'f01' },
        west_wall: { room: 'f10' },
        south_wall: 'external',
        east_wall: 'external',
        floor: { room: 'g11', type: 'floor_ceiling' },
        ceiling: 'roof',
      }),
    }

    const out = solveLayout(rooms)
    expect(Object.keys(out.rooms).sort()).toEqual(
      ['f00', 'f01', 'f10', 'f11', 'g00', 'g01', 'g10', 'g11'],
    )
    for (const name of Object.keys(out.rooms)) {
      expect(out.rooms[name].col).not.toBe(10)
    }
    const ground = Object.values(out.rooms).filter((r) => r.floor === 0)
    const first = Object.values(out.rooms).filter((r) => r.floor === 1)
    expect(ground.length).toBe(4)
    expect(first.length).toBe(4)
    expect(out.buildingWidth).toBeGreaterThan(0)
    expect(out.floorCount).toBe(2)
    expect(Number.isFinite(out.centroid.x)).toBe(true)
    expect(Number.isFinite(out.centroid.z)).toBe(true)

    for (const pool of [ground, first]) {
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          expect(overlaps(pool[i], pool[j])).toBe(false)
        }
      }
    }
  })

  it('6. empty input returns an empty layout', () => {
    const out = solveLayout({})
    expect(out.rooms).toEqual({})
    expect(out.floorCount).toBe(0)
    expect(out.centroid).toEqual({ x: 0, z: 0 })
    expect(out.buildingWidth).toBe(0)
  })

  it('7. a disconnected second room is flagged as an orphan', () => {
    const out = solveLayout({
      A: room(20, 0, {
        north_wall: 'external',
        south_wall: 'external',
        east_wall: 'external',
        west_wall: 'external',
      }),
      B: room(15, 0, {
        north_wall: 'external',
        south_wall: 'external',
        east_wall: 'external',
        west_wall: 'external',
      }),
    })
    expect(out.rooms.A.col).toBe(0)
    expect(out.rooms.A.row).toBe(0)
    expect(out.rooms.B.col).toBe(10)
    expect(out.log.some((e) => e.level === 'warn' && /orphan/i.test(e.msg))).toBe(true)
  })

  it('8. solveLayout is deterministic across repeated calls', () => {
    const build = (): Record<string, LayoutRoom> => ({
      g00: room(22, 0, {
        east_wall: { room: 'g01' },
        south_wall: { room: 'g10' },
        ceiling: { room: 'f00', type: 'floor_ceiling' },
      }),
      g01: room(15, 0, {
        west_wall: { room: 'g00' },
        south_wall: { room: 'g11' },
      }),
      g10: room(14, 0, {
        north_wall: { room: 'g00' },
        east_wall: { room: 'g11' },
      }),
      g11: room(16, 0, {
        north_wall: { room: 'g01' },
        west_wall: { room: 'g10' },
        ceiling: { room: 'f11', type: 'floor_ceiling' },
      }),
      f00: room(20, 1, {
        east_wall: { room: 'f01' },
        south_wall: { room: 'f10' },
        floor: { room: 'g00', type: 'floor_ceiling' },
      }),
      f01: room(12, 1, {
        west_wall: { room: 'f00' },
        south_wall: { room: 'f11' },
      }),
      f10: room(13, 1, {
        north_wall: { room: 'f00' },
        east_wall: { room: 'f11' },
      }),
      f11: room(14, 1, {
        north_wall: { room: 'f01' },
        west_wall: { room: 'f10' },
        floor: { room: 'g11', type: 'floor_ceiling' },
      }),
    })
    const a = solveLayout(build())
    const b = solveLayout(build())
    expect(a.rooms).toEqual(b.rooms)
    expect(a.centroid).toEqual(b.centroid)
    expect(a.buildingWidth).toBe(b.buildingWidth)
    expect(a.floorCount).toBe(b.floorCount)
  })

  it('9. three-floor input is rejected with a clear error', () => {
    expect(() =>
      solveLayout({
        A: room(20, 0, {}),
        B: room(15, 1, {}),
        C: room(10, 2, {}),
      }),
    ).toThrow(/max 2 floors/)
  })
})
