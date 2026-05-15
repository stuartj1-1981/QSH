import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { FallbackCountsResponse } from '../types/api'

interface UseFallbackCountsResult {
  data: FallbackCountsResponse | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useFallbackCounts(): UseFallbackCountsResult {
  const [data, setData] = useState<FallbackCountsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState(0)

  const refetch = useCallback(() => setTrigger((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => setLoading(true))
    fetch(apiUrl('api/forecast/fallback-counts'), { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`GET /api/forecast/fallback-counts failed: ${r.status}`)
        return r.json()
      })
      .then((json: FallbackCountsResponse) => {
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
  }, [trigger])

  return { data, loading, error, refetch }
}
