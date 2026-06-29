import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { DeviceHealthResponse } from '../types/api'

// INSTRUCTION-371B — fetch hook for the engineering Device Health page.
// Mirrors useBalancing: ingress-aware apiUrl(), typed return, loading + error
// states, mounted-guard, 30 s poll.
export function useDeviceHealth() {
  const [data, setData] = useState<DeviceHealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(() => {
    let mounted = true
    fetch(apiUrl('api/devices/health'))
      .then((r) => r.json())
      .then((d) => {
        if (!mounted) return
        setData(d as DeviceHealthResponse)
        setError(null)
      })
      .catch((e) => {
        if (mounted) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const cleanup = fetchData()
    const interval = setInterval(fetchData, 30_000)
    return () => {
      cleanup?.()
      clearInterval(interval)
    }
  }, [fetchData])

  return { data, error, loading, refetch: fetchData }
}
