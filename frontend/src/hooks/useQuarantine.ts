import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { QuarantineStatus } from '../types/api'

// INSTRUCTION-288B — poll the unit-side quarantine read surface
// (GET /api/swarm/quarantine over SwarmPublisher.latest_quarantine()).
// Quarantine state changes rarely, so a 60s interval is ample. Mirrors the
// useBalancing fetch/poll/error pattern (ingress-aware apiUrl).
export function useQuarantine() {
  const [data, setData] = useState<QuarantineStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    fetch(apiUrl('api/swarm/quarantine'))
      .then((r) => r.json())
      .then((d) => {
        setData(d as QuarantineStatus)
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
