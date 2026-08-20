import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import { useRawConfig, usePatchConfig } from './useConfig'
import type { PredictiveResponse } from '../types/api'

/**
 * Predictive-occupancy report + per-room enable toggle (INSTRUCTION-478B).
 *
 * The toggle is pinned to the witnessed config surface (M3, closing
 * iFAT-86 F5): read the current `rooms` section via useRawConfig, flip the
 * one room's `predictive_occupancy` key, and write the whole section back
 * via usePatchConfig('rooms', ...) — NOT /api/rooms PUT, whose RoomConfig
 * model carries none of the per-room occupancy keys.
 */
export function usePredictive() {
  const [data, setData] = useState<PredictiveResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [restartNotice, setRestartNotice] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    fetch(apiUrl('api/predictive'))
      .then((r) => r.json())
      .then((d) => {
        setData(d as PredictiveResponse)
        setError(null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30_000)
    return () => clearInterval(interval)
  }, [fetchData])

  const { data: rawConfig, refetch: refetchConfig } = useRawConfig()
  const { patch } = usePatchConfig()

  const setPredictiveEnabled = useCallback(
    async (room: string, enabled: boolean) => {
      const rooms = rawConfig?.rooms
      if (!rooms || !rooms[room]) {
        setError(`Cannot toggle predictive occupancy: room "${room}" not found in config`)
        return
      }
      const nextRooms = {
        ...rooms,
        [room]: { ...rooms[room], predictive_occupancy: enabled },
      }
      try {
        const result = await patch('rooms', nextRooms)
        if (result) {
          setRestartNotice(result.message)
          refetchConfig()
          fetchData()
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [rawConfig, patch, refetchConfig, fetchData],
  )

  return { data, error, loading, refetch: fetchData, setPredictiveEnabled, restartNotice }
}
