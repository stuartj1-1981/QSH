import { useState, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { ScanEntitiesResponse, ScanRoomResponse, EntityCandidate } from '../types/config'

/** Scan for global entity candidates (HP sensors, outdoor, solar). */
export function useEntityScan() {
  const [candidates, setCandidates] = useState<Record<string, EntityCandidate[]>>({})
  const [totalEntities, setTotalEntities] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(async (domainFilter?: string[]) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(apiUrl('api/wizard/scan-entities'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_filter: domainFilter }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }
      const data: ScanEntitiesResponse = await resp.json()
      setCandidates(data.candidates)
      setTotalEntities(data.total_entities)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  return { candidates, totalEntities, loading, error, scan }
}

/** Scan for room-specific entity candidates (TRV, sensor, heating). */
export function useRoomEntityScan() {
  const [roomCandidates, setRoomCandidates] = useState<
    Record<string, Record<string, EntityCandidate[]>>
  >({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scanRoom = useCallback(async (roomName: string) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(apiUrl(`api/wizard/scan-entities/${roomName}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }
      const data: ScanRoomResponse = await resp.json()
      setRoomCandidates((prev) => ({
        ...prev,
        [roomName]: data.candidates,
      }))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  return { roomCandidates, loading, error, scanRoom }
}
