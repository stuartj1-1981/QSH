import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { FeatureFlagsResponse } from '../types/api'

interface UseFeatureFlagsResult {
  data: FeatureFlagsResponse | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useFeatureFlags(): UseFeatureFlagsResult {
  const [data, setData] = useState<FeatureFlagsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState(0)

  const refetch = useCallback(() => setTrigger((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => setLoading(true))
    fetch(apiUrl('api/forecast/feature-flags'), { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`GET /api/forecast/feature-flags failed: ${r.status}`)
        return r.json()
      })
      .then((json: FeatureFlagsResponse) => {
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
