import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { CutoverGatesResponse } from '../types/api'

interface UseCutoverGatesResult {
  data: CutoverGatesResponse | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useCutoverGates(windowCycles: number = 168): UseCutoverGatesResult {
  const [data, setData] = useState<CutoverGatesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState(0)

  const refetch = useCallback(() => setTrigger((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => setLoading(true))
    fetch(
      apiUrl(`api/forecast/cutover-gates?window_cycles=${windowCycles}`),
      { signal: controller.signal },
    )
      .then((r) => {
        if (!r.ok) throw new Error(`GET /api/forecast/cutover-gates failed: ${r.status}`)
        return r.json()
      })
      .then((json: CutoverGatesResponse) => {
        setData(json)
        setError(null)
        setLoading(false)
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Fetch failed')
        setLoading(false)
      })
    return () => controller.abort()
  }, [trigger, windowCycles])

  return { data, loading, error, refetch }
}
