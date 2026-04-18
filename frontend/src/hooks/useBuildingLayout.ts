import { useMemo } from 'react'
import { useRawConfig } from './useConfig'
import { solveLayout, type SolvedLayout, type LayoutRoom } from '../lib/buildingLayout'
import type { RoomConfigYaml } from '../types/config'

export interface UseBuildingLayoutResult {
  layout: SolvedLayout | null
  /** Raw config rooms (for detail panel / face descriptions). */
  rooms: Record<string, RoomConfigYaml> | null
  /** LayoutRoom records passed to BuildingEngine.setLayout. */
  layoutRooms: Record<string, LayoutRoom> | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  /** True when the config has rooms with envelope data (3D toggle prerequisite). */
  hasEnvelopeData: boolean
}

export function useBuildingLayout(): UseBuildingLayoutResult {
  const { data, loading, error, refetch } = useRawConfig()
  const rawRooms = data?.rooms ?? null

  // Content-hash memo: solveLayout only re-runs when the serialized rooms
  // payload actually changes, not on every useRawConfig refetch.
  const roomsJson = JSON.stringify(rawRooms)

  const result = useMemo(() => {
    if (roomsJson === 'null') {
      return { layout: null, layoutRooms: null, hasEnvelopeData: false }
    }
    const parsed = JSON.parse(roomsJson) as Record<string, RoomConfigYaml>
    const layoutRooms: Record<string, LayoutRoom> = {}
    for (const [name, cfg] of Object.entries(parsed)) {
      if (!cfg.envelope) continue
      layoutRooms[name] = {
        area_m2: cfg.area_m2,
        ceiling_m: cfg.ceiling_m ?? 2.4,
        floor: cfg.floor ?? 0,
        envelope: cfg.envelope,
      }
    }
    const hasData = Object.keys(layoutRooms).length > 0
    return {
      layout: hasData ? solveLayout(layoutRooms) : null,
      layoutRooms: hasData ? layoutRooms : null,
      hasEnvelopeData: hasData,
    }
  }, [roomsJson])

  return {
    layout: result.layout,
    rooms: rawRooms,
    layoutRooms: result.layoutRooms,
    loading,
    error,
    refetch,
    hasEnvelopeData: result.hasEnvelopeData,
  }
}
