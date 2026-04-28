import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl } from '../lib/api'
import type { ScanEntitiesResponse, ScanRoomResponse, EntityCandidate } from '../types/config'

/** Scan for global entity candidates (HP sensors, outdoor, solar).
 *
 * INSTRUCTION-90C: fires automatically on mount and every time the wizard
 * remounts the consuming component, so revisiting a step always shows a
 * fresh evaluation against the current HA entity registry. `refresh()`
 * is also exposed for manual re-scan (e.g. after the user added new
 * entities in HA without leaving the wizard).
 *
 * `options.autoScan` defaults to true. Pass `{ autoScan: false }` to
 * suppress the mount-time fetch (used by consumers that read candidates
 * but don't need their own scan cycle, e.g. StepHotWater if it shares
 * state with a parent).
 */
export interface UseEntityScanOptions {
  autoScan?: boolean
  domainFilter?: string[]
}

export function useEntityScan(options: UseEntityScanOptions = {}) {
  const { autoScan = true, domainFilter } = options
  const [candidates, setCandidates] = useState<Record<string, EntityCandidate[]>>({})
  const [totalEntities, setTotalEntities] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const scan = useCallback(async (df?: string[]) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(apiUrl('api/wizard/scan-entities'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_filter: df ?? domainFilter }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }
      const data: ScanEntitiesResponse = await resp.json()
      if (!mountedRef.current) return
      setCandidates(data.candidates)
      setTotalEntities(data.total_entities)
    } catch (e: unknown) {
      if (!mountedRef.current) return
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [domainFilter])

  // Auto-scan on mount + clean up on unmount so a return visit starts clean.
  useEffect(() => {
    mountedRef.current = true
    if (autoScan) {
      void scan()
    }
    return () => {
      mountedRef.current = false
    }
  }, [autoScan, scan])

  return { candidates, totalEntities, loading, error, scan, refresh: scan }
}

/** Scan for room-specific entity candidates (TRV, sensor, heating). */
export function useRoomEntityScan() {
  const [roomCandidates, setRoomCandidates] = useState<
    Record<string, Record<string, EntityCandidate[]>>
  >({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastScanByRoom, setLastScanByRoom] = useState<Record<string, number>>({})
  const [loadingByRoom, setLoadingByRoom] = useState<Record<string, boolean>>({})
  const [errorByRoom, setErrorByRoom] = useState<Record<string, string | null>>({})
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const scanRoom = useCallback(async (roomName: string) => {
    setLoading(true)
    setError(null)
    setLoadingByRoom((prev) => ({ ...prev, [roomName]: true }))
    setErrorByRoom((prev) => ({ ...prev, [roomName]: null }))
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
      if (!mountedRef.current) return
      setRoomCandidates((prev) => ({
        ...prev,
        [roomName]: data.candidates,
      }))
      setLastScanByRoom((prev) => ({ ...prev, [roomName]: Date.now() }))
    } catch (e: unknown) {
      if (!mountedRef.current) return
      const message = e instanceof Error ? e.message : 'Unknown error'
      setError(message)
      setErrorByRoom((prev) => ({ ...prev, [roomName]: message }))
    } finally {
      if (mountedRef.current) {
        setLoading(false)
        setLoadingByRoom((prev) => ({ ...prev, [roomName]: false }))
      }
    }
  }, [])

  return {
    roomCandidates,
    loading,
    error,
    scanRoom,
    refresh: scanRoom,
    lastScanByRoom,
    loadingByRoom,
    errorByRoom,
  }
}
