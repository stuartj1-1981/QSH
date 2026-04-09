import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { TrendPoint } from '../types/api'

interface UseTrendsResult {
  data: TrendPoint[]
  loading: boolean
  error: string | null
}

export function useTrends(
  metric: string,
  hours: number = 24,
  room?: string,
): UseTrendsResult {
  const [data, setData] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (signal: AbortSignal) => {
    try {
      const params = new URLSearchParams({
        metric,
        hours: String(hours),
      })
      if (room) params.set('room', room)

      const resp = await fetch(apiUrl(`api/trends?${params}`), { signal })
      if (!resp.ok) {
        setError(`HTTP ${resp.status}`)
        return
      }
      const json = await resp.json()
      setData(json.points ?? [])
      setError(null)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }, [metric, hours, room])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)

    fetchData(controller.signal)
    const interval = setInterval(() => fetchData(controller.signal), 60_000)

    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [fetchData])

  return { data, loading, error }
}
