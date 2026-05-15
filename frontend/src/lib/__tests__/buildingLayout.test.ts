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

  it('9. three-floor cumulative anchor chain: floor 2 aligns to the SHIFTED floor 1', () => {
    // Geometry chosen so per-floor BFS produces asymmetric placement and the
    // floor 0→1 anchor produces a NON-ZERO shift that floor 1→2 must read.
    //
    // Floor 0: G1 (30 m², seed at col=0) WEST, G2 (10 m², east of G1 at col=1).
    // Floor 1: F1 (30 m², seed at col=0) WEST, F2 (10 m², east of F1 at col=1).
    // Floor 2: S1 (10 m², seed at col=0).
    // Anchors: G2.ceiling → F1   (pair 0→1: lower=G2 east-side, upper=F1 west-side)
    //          F2.ceiling → S1   (pair 1→2: lower=F2 east-side, upper=S1)
    //
    // Hand calc (buildingWidth = sqrt(40)*1.1 ≈ 6.957, rowDepth_F0_F1 ≈ 5.749):
    //   G1.cx ≈ 2.609   G2.cx ≈ 6.087  (G2 east of G1)
    //   F1.cx ≈ 2.609   F2.cx ≈ 6.087  (pre-shift; same layout as floor 0)
    //   S1.cx ≈ 3.479                   (pre-shift; S1 spans the full bldg width)
    //
    // Pair (0,1): offsetX = G2.cx - F1.cx ≈ +3.478. Floor 1 shifts east by 3.478.
    //   F1.cx_shifted ≈ 6.087 (== G2.cx ✓)
    //   F2.cx_shifted ≈ 9.565
    //
    // Pair (1,2): a CUMULATIVE impl reads F2.cx_shifted ≈ 9.565.
    //   offsetX = 9.565 - 3.479 ≈ +6.086. S1.cx_shifted ≈ 9.565 (== F2.cx_shifted ✓)
    //
    // A NON-cumulative impl reads F2.cx_unshifted ≈ 6.087:
    //   offsetX_buggy = 6.087 - 3.479 ≈ +2.608. S1.cx_buggy ≈ 6.087.
    //   |6.087 - 9.565| ≈ 3.478 — fails the 0.5 tolerance assertion below by ~7×.
    const rooms: Record<string, LayoutRoom> = {
      G1: room(30, 0, {
        east_wall: { room: 'G2' },
        north_wall: 'external',
        south_wall: 'external',
        west_wall: 'external',
        floor: 'ground',
      }),
      G2: room(10, 0, {
        west_wall: { room: 'G1' },
        north_wall: 'external',
        south_wall: 'external',
        east_wall: 'external',
        floor: 'ground',
        ceiling: { room: 'F1', type: 'floor_ceiling' },
      }),
      F1: room(30, 1, {
        east_wall: { room: 'F2' },
        north_wall: 'external',
        south_wall: 'external',
        west_wall: 'external',
        floor: { room: 'G2', type: 'floor_ceiling' },
      }),
      F2: room(10, 1, {
        west_wall: { room: 'F1' },
        north_wall: 'external',
        south_wall: 'external',
        east_wall: 'external',
        ceiling: { room: 'S1', type: 'floor_ceiling' },
      }),
      S1: room(10, 2, {
        north_wall: 'external',
        south_wall: 'external',
        east_wall: 'external',
        west_wall: 'external',
        floor: { room: 'F2', type: 'floor_ceiling' },
        ceiling: 'roof',
      }),
    }
    const out = solveLayout(rooms)
    expect(out.floorCount).toBe(3)
    const cx = (r: SolvedRoom): number => r.x + r.w / 2

    // Pair (0,1) alignment: F1.cx must equal G2.cx (the anchor partners).
    expect(Math.abs(cx(out.rooms.F1) - cx(out.rooms.G2))).toBeLessThan(0.5)

    // Pair (1,2) alignment using the SHIFTED F2 position. This is the
    // discriminating assertion — a non-cumulative impl fails by ~3.5m.
    expect(Math.abs(cx(out.rooms.S1) - cx(out.rooms.F2))).toBeLessThan(0.5)

    // Log entries for both inter-floor anchors.
    const okMsgs = out.log.filter((e) => e.level === 'ok').map((e) => e.msg)
    expect(okMsgs.some((m) => /Floor 1 anchored to 0/.test(m))).toBe(true)
    expect(okMsgs.some((m) => /Floor 2 anchored to 1/.test(m))).toBe(true)
  })

  it('10. three-floor layout: per-floor rooms do not overlap', () => {
    const rooms: Record<string, LayoutRoom> = {
      g0: room(22, 0, {
        east_wall: { room: 'g1' },
        ceiling: { room: 'f0', type: 'floor_ceiling' },
      }),
      g1: room(18, 0, { west_wall: { room: 'g0' } }),
      f0: room(20, 1, {
        east_wall: { room: 'f1' },
        floor: { room: 'g0', type: 'floor_ceiling' },
        ceiling: { room: 's0', type: 'floor_ceiling' },
      }),
      f1: room(15, 1, { west_wall: { room: 'f0' } }),
      s0: room(16, 2, {
        east_wall: { room: 's1' },
        floor: { room: 'f0', type: 'floor_ceiling' },
      }),
      s1: room(12, 2, { west_wall: { room: 's0' } }),
    }
    const out = solveLayout(rooms)
    expect(out.floorCount).toBe(3)
    const byFloor: Record<number, SolvedRoom[]> = { 0: [], 1: [], 2: [] }
    for (const r of Object.values(out.rooms)) byFloor[r.floor].push(r)
    for (const f of [0, 1, 2]) {
      const pool = byFloor[f]
      expect(pool.length).toBe(2)
      expect(overlaps(pool[0], pool[1])).toBe(false)
    }
  })

  it('11. basement + ground + first solves with floors [-1, 0, 1] and anchors across the sign boundary', () => {
    const rooms: Record<string, LayoutRoom> = {
      cellar: room(15, -1, {
        ceiling: { room: 'g0', type: 'floor_ceiling' },
        floor: 'ground',
      }),
      g0: room(20, 0, {
        floor: { room: 'cellar', type: 'floor_ceiling' },
        ceiling: { room: 'f0', type: 'floor_ceiling' },
      }),
      f0: room(18, 1, {
        floor: { room: 'g0', type: 'floor_ceiling' },
        ceiling: 'roof',
      }),
    }
    const out = solveLayout(rooms)
    expect(out.floorCount).toBe(3)
    expect(out.rooms.cellar.floor).toBe(-1)
    expect(out.rooms.g0.floor).toBe(0)
    expect(out.rooms.f0.floor).toBe(1)

    // V1 LOW-3: confirm the basement→ground anchor fires across the sign
    // boundary (numeric-comparator sort produces [-1, 0, 1] not ["-1", "0", "1"]).
    const okMsgs = out.log.filter((e) => e.level === 'ok').map((e) => e.msg)
    expect(okMsgs.some((m) => /Floor 0 anchored to -1/.test(m))).toBe(true)
    expect(okMsgs.some((m) => /Floor 1 anchored to 0/.test(m))).toBe(true)

    // V1 LOW-3: centroids align under the single-anchor chain.
    const cx = (r: SolvedRoom): number => r.x + r.w / 2
    const cz = (r: SolvedRoom): number => r.z + r.d / 2
    expect(Math.abs(cx(out.rooms.cellar) - cx(out.rooms.g0))).toBeLessThan(0.5)
    expect(Math.abs(cz(out.rooms.cellar) - cz(out.rooms.g0))).toBeLessThan(0.5)
    expect(Math.abs(cx(out.rooms.g0) - cx(out.rooms.f0))).toBeLessThan(0.5)
    expect(Math.abs(cz(out.rooms.g0) - cz(out.rooms.f0))).toBeLessThan(0.5)
  })

  it('12. three-floor solveLayout is deterministic across repeated calls', () => {
    const build = (): Record<string, LayoutRoom> => ({
      g0: room(20, 0, { ceiling: { room: 'f0', type: 'floor_ceiling' } }),
      f0: room(20, 1, {
        floor: { room: 'g0', type: 'floor_ceiling' },
        ceiling: { room: 's0', type: 'floor_ceiling' },
      }),
      s0: room(20, 2, { floor: { room: 'f0', type: 'floor_ceiling' } }),
    })
    const a = solveLayout(build())
    const b = solveLayout(build())
    expect(a.rooms).toEqual(b.rooms)
    expect(a.centroid).toEqual(b.centroid)
    expect(a.buildingWidth).toBe(b.buildingWidth)
    expect(a.floorCount).toBe(b.floorCount)
  })

  it('13. non-consecutive floor indices [0, 2] do not crash; pair (0, 2) anchors directly', () => {
    // V1 LOW-4: the consecutive-pairs loop treats sorted indices as adjacent,
    // even when there is a numeric gap. A user who declares rooms only on
    // floors 0 and 2 (with floor 1 unused) should get a working layout, not
    // a throw. Backend _validate_vertical_consistency will have already
    // warned that g0.ceiling → s0 expects floor=1; the solver still produces
    // a usable result.
    const rooms: Record<string, LayoutRoom> = {
      g0: room(20, 0, {
        ceiling: { room: 's0', type: 'floor_ceiling' },
        floor: 'ground',
        north_wall: 'external',
        south_wall: 'external',
        east_wall: 'external',
        west_wall: 'external',
      }),
      s0: room(20, 2, {
        floor: { room: 'g0', type: 'floor_ceiling' },
        ceiling: 'roof',
        north_wall: 'external',
        south_wall: 'external',
        east_wall: 'external',
        west_wall: 'external',
      }),
    }
    const out = solveLayout(rooms)
    expect(out.floorCount).toBe(2)
    // Anchor pair (0, 2) treated as adjacent — log message reflects actual indices.
    const okMsgs = out.log.filter((e) => e.level === 'ok').map((e) => e.msg)
    expect(okMsgs.some((m) => /Floor 2 anchored to 0/.test(m))).toBe(true)
    // Centroids align via the single anchor pair.
    const cx = (r: SolvedRoom): number => r.x + r.w / 2
    expect(Math.abs(cx(out.rooms.g0) - cx(out.rooms.s0))).toBeLessThan(0.5)
  })
})
