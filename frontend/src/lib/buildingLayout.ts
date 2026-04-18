/** Grid-based building layout solver.
 *
 *  Converts a map of rooms (area, floor, envelope) into world-space rectangles
 *  by running BFS over wall adjacency, deriving row depths and column widths
 *  from per-floor area totals, and anchoring the upper floor to the lower
 *  via ceiling/floor envelope pairs.
 *
 *  The solver is pure — no rendering, no DOM, no Three.js. Inputs are cloned
 *  where mutated so the caller's data is untouched.
 */

import type { RoomEnvelopeYaml } from '../types/config'
import { normaliseFaceRefs } from '../types/config'

/** Minimal room input for the layout solver. */
export interface LayoutRoom {
  area_m2: number
  ceiling_m: number
  floor: number
  envelope: RoomEnvelopeYaml
}

/** Solver output: world-space position and dimensions for one room. */
export interface SolvedRoom {
  x: number       // left edge, metres
  z: number       // front edge, metres
  w: number       // width (east-west), metres
  d: number       // depth (north-south), metres
  floor: number   // storey index
  col: number     // grid column assigned by BFS
  row: number     // grid row assigned by BFS
}

/** Full solver result. */
export interface SolvedLayout {
  rooms: Record<string, SolvedRoom>
  centroid: { x: number; z: number }
  buildingWidth: number
  floorCount: number
  log: SolverLogEntry[]
}

export interface SolverLogEntry {
  msg: string
  level: 'info' | 'ok' | 'warn'
}

type WallKey = 'north_wall' | 'east_wall' | 'south_wall' | 'west_wall'

const WALL_KEYS: readonly WallKey[] = [
  'north_wall',
  'east_wall',
  'south_wall',
  'west_wall',
] as const

/** Grid step per wall face. +z is south, +x is east. */
const DIRECTIONS: Record<WallKey, { dc: number; dr: number }> = {
  east_wall: { dc: 1, dr: 0 },
  west_wall: { dc: -1, dr: 0 },
  north_wall: { dc: 0, dr: -1 },
  south_wall: { dc: 0, dr: 1 },
}

const ORPHAN_COL = 10
const ORPHAN_ROW = 0

/** Spiral search for nearest unoccupied grid cell. */
function findFreeCell(
  startCol: number,
  startRow: number,
  occupied: Set<string>,
): { col: number; row: number } | null {
  for (let radius = 1; radius <= 5; radius++) {
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.abs(dc) !== radius && Math.abs(dr) !== radius) continue
        const key = `${startCol + dc},${startRow + dr}`
        if (!occupied.has(key)) return { col: startCol + dc, row: startRow + dr }
      }
    }
  }
  return null
}

/** Solve the layout for the given rooms.
 *
 *  Deterministic: identical inputs produce identical outputs.
 *  Throws when more than 2 distinct floor indices are present — the solver
 *  targets UK residential scope (ground + first) and would silently misplace
 *  rooms on additional storeys.
 */
export function solveLayout(rooms: Record<string, LayoutRoom>): SolvedLayout {
  const log: SolverLogEntry[] = []
  const roomNames = Object.keys(rooms)

  if (roomNames.length === 0) {
    return {
      rooms: {},
      centroid: { x: 0, z: 0 },
      buildingWidth: 0,
      floorCount: 0,
      log,
    }
  }

  const floorIndices = [...new Set(roomNames.map((n) => rooms[n].floor))].sort(
    (a, b) => a - b,
  )
  if (floorIndices.length > 2) {
    throw new Error(
      `BuildingLayout solver supports max 2 floors, got ${floorIndices.length}: [${floorIndices.join(', ')}]`,
    )
  }

  const floorArea: Record<number, number> = {}
  for (const name of roomNames) {
    const r = rooms[name]
    floorArea[r.floor] = (floorArea[r.floor] ?? 0) + r.area_m2
  }
  const maxFloorArea = Math.max(...Object.values(floorArea))
  const buildingWidth = Math.sqrt(maxFloorArea) * 1.1

  const gridPos: Record<string, { col: number; row: number }> = {}

  for (const floor of floorIndices) {
    const roomsOnFloor = roomNames.filter((n) => rooms[n].floor === floor)
    if (roomsOnFloor.length === 0) continue

    const seed = roomsOnFloor.reduce((best, cur) =>
      rooms[cur].area_m2 > rooms[best].area_m2 ? cur : best,
    )
    gridPos[seed] = { col: 0, row: 0 }
    log.push({
      msg: `Floor ${floor}: seed ${seed} (${rooms[seed].area_m2.toFixed(1)} m²) at (0,0)`,
      level: 'info',
    })

    const visited = new Set<string>([seed])
    const queue: string[] = [seed]
    const occupiedCells = new Set<string>()
    occupiedCells.add('0,0')

    while (queue.length > 0) {
      const current = queue.shift() as string
      const env = rooms[current].envelope
      const pos = gridPos[current]

      for (const wall of WALL_KEYS) {
        const face = env[wall]
        const refs = normaliseFaceRefs(face)
        for (const ref of refs) {
          const neighbour = ref.room
          if (!rooms[neighbour]) continue
          if (rooms[neighbour].floor !== floor) continue
          if (visited.has(neighbour)) continue

          const dir = DIRECTIONS[wall]
          const targetCol = pos.col + dir.dc
          const targetRow = pos.row + dir.dr

          const posKey = `${targetCol},${targetRow}`
          if (occupiedCells.has(posKey)) {
            const free = findFreeCell(targetCol, targetRow, occupiedCells)
            if (free) {
              gridPos[neighbour] = { col: free.col, row: free.row }
              occupiedCells.add(`${free.col},${free.row}`)
              log.push({
                msg: `Grid collision: ${neighbour} shifted from (${targetCol},${targetRow}) to (${free.col},${free.row})`,
                level: 'warn',
              })
            } else {
              gridPos[neighbour] = { col: ORPHAN_COL, row: ORPHAN_ROW }
              log.push({
                msg: `Grid collision: ${neighbour} could not be placed, orphaned`,
                level: 'warn',
              })
            }
          } else {
            gridPos[neighbour] = { col: targetCol, row: targetRow }
            occupiedCells.add(posKey)
          }
          visited.add(neighbour)
          queue.push(neighbour)
        }
      }
    }

    for (const name of roomsOnFloor) {
      if (!visited.has(name)) {
        gridPos[name] = { col: ORPHAN_COL, row: ORPHAN_ROW }
        log.push({
          msg: `Orphan room ${name}: no wall adjacency to seed on floor ${floor}`,
          level: 'warn',
        })
      }
    }
  }

  const solvedRooms: Record<string, SolvedRoom> = {}

  for (const floor of floorIndices) {
    const roomsOnFloor = roomNames.filter((n) => rooms[n].floor === floor)
    if (roomsOnFloor.length === 0) continue

    const rowArea: Record<number, number> = {}
    const colRooms: Record<number, string[]> = {}
    for (const name of roomsOnFloor) {
      const pos = gridPos[name]
      rowArea[pos.row] = (rowArea[pos.row] ?? 0) + rooms[name].area_m2
      const bucket = colRooms[pos.col] ?? []
      bucket.push(name)
      colRooms[pos.col] = bucket
    }

    const rowDepth: Record<number, number> = {}
    for (const [rowStr, area] of Object.entries(rowArea)) {
      rowDepth[Number(rowStr)] = area / buildingWidth
    }

    const colWidth: Record<number, number> = {}
    for (const [colStr, names] of Object.entries(colRooms)) {
      let sum = 0
      for (const name of names) {
        const pos = gridPos[name]
        sum += rooms[name].area_m2 / rowDepth[pos.row]
      }
      colWidth[Number(colStr)] = sum / names.length
    }

    const rowsSorted = Object.keys(rowDepth).map(Number).sort((a, b) => a - b)
    const colsSorted = Object.keys(colWidth).map(Number).sort((a, b) => a - b)

    const rowOffset: Record<number, number> = {}
    let zAcc = 0
    for (const r of rowsSorted) {
      rowOffset[r] = zAcc
      zAcc += rowDepth[r]
    }

    const colOffset: Record<number, number> = {}
    let xAcc = 0
    for (const c of colsSorted) {
      colOffset[c] = xAcc
      xAcc += colWidth[c]
    }

    for (const name of roomsOnFloor) {
      const pos = gridPos[name]
      solvedRooms[name] = {
        x: colOffset[pos.col],
        z: rowOffset[pos.row],
        w: colWidth[pos.col],
        d: rowDepth[pos.row],
        floor,
        col: pos.col,
        row: pos.row,
      }
    }
  }

  if (floorIndices.length === 2) {
    const [lowerFloor, upperFloor] = floorIndices
    const pairs: Array<{ lower: string; upper: string; weight: number }> = []
    const seen = new Set<string>()

    const addPair = (lower: string, upper: string) => {
      if (!rooms[lower] || !rooms[upper]) return
      if (rooms[lower].floor !== lowerFloor || rooms[upper].floor !== upperFloor) return
      const key = `${lower}|${upper}`
      if (seen.has(key)) return
      seen.add(key)
      pairs.push({
        lower,
        upper,
        weight: (rooms[lower].area_m2 + rooms[upper].area_m2) / 2,
      })
    }

    for (const name of roomNames) {
      const r = rooms[name]
      if (r.floor === lowerFloor) {
        const ceilingRefs = normaliseFaceRefs(r.envelope.ceiling)
        for (const ref of ceilingRefs) {
          addPair(name, ref.room)
        }
      }
      if (r.floor === upperFloor) {
        const floorRefs = normaliseFaceRefs(r.envelope.floor)
        for (const ref of floorRefs) {
          addPair(ref.room, name)
        }
      }
    }

    if (pairs.length > 0) {
      let totalWeight = 0
      let sumDx = 0
      let sumDz = 0
      for (const p of pairs) {
        const lower = solvedRooms[p.lower]
        const upper = solvedRooms[p.upper]
        const lowerCx = lower.x + lower.w / 2
        const lowerCz = lower.z + lower.d / 2
        const upperCx = upper.x + upper.w / 2
        const upperCz = upper.z + upper.d / 2
        sumDx += (lowerCx - upperCx) * p.weight
        sumDz += (lowerCz - upperCz) * p.weight
        totalWeight += p.weight
      }
      if (totalWeight > 0) {
        const offsetX = sumDx / totalWeight
        const offsetZ = sumDz / totalWeight
        for (const name of roomNames) {
          if (rooms[name].floor === upperFloor) {
            solvedRooms[name].x += offsetX
            solvedRooms[name].z += offsetZ
          }
        }
        log.push({
          msg: `Upper floor anchored via ${pairs.length} ceiling/floor pair(s); shift (${offsetX.toFixed(2)}, ${offsetZ.toFixed(2)})`,
          level: 'ok',
        })
      }
    }
  }

  let sumX = 0
  let sumZ = 0
  const solvedNames = Object.keys(solvedRooms)
  for (const name of solvedNames) {
    const s = solvedRooms[name]
    sumX += s.x + s.w / 2
    sumZ += s.z + s.d / 2
  }
  const centroid =
    solvedNames.length > 0
      ? { x: sumX / solvedNames.length, z: sumZ / solvedNames.length }
      : { x: 0, z: 0 }

  return {
    rooms: solvedRooms,
    centroid,
    buildingWidth,
    floorCount: floorIndices.length,
    log,
  }
}
