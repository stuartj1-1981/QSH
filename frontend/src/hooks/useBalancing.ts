import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { BalancingResponse } from '../types/api'

export function useBalancing() {
  const [data, setData] = useState<BalancingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(() => {
    fetch(apiUrl('api/balancing'))
      .then((r) => r.json())
      .then((d) => {
        setData(d as BalancingResponse)
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

  const setNotificationDisabled = useCallback(
    async (room: string, disabled: boolean) => {
      try {
        const res = await fetch(apiUrl(`api/balancing/${encodeURIComponent(room)}/notifications`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disabled }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.detail || `HTTP ${res.status}`)
        }
        fetchData()
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [fetchData],
  )

  return { data, error, loading, refetch: fetchData, setNotificationDisabled }
}
