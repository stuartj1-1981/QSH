import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { ApoptosisStatus } from '../types/api'

// INSTRUCTION-321B — poll the unit-side apoptosis read surface
// (GET /api/swarm/apoptosis over SwarmPublisher.apoptosis_status() +
// is_self_suspended()). Apoptosis state changes rarely, so a 60s interval is
// ample. Mirrors the useQuarantine fetch/poll/error pattern (ingress-aware apiUrl).
export function useApoptosis() {
  const [data, setData] = useState<ApoptosisStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    fetch(apiUrl('api/swarm/apoptosis'))
      .then((r) => r.json())
      .then((d) => {
        setData(d as ApoptosisStatus)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [fetchData])

  return { data, error, refetch: fetchData }
}
