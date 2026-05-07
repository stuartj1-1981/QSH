import { useEffect, useState, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { ScopMode, ScopResponse, ScopWindow } from '../types/api'

interface UseScopResult {
  data: ScopResponse | null
  loading: boolean
  error: string | null
}

export function useScop(window: ScopWindow, mode: ScopMode): UseScopResult {
  const [data, setData] = useState<ScopResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(
    (signal: AbortSignal) => {
      return fetch(apiUrl(`api/scop?window=${window}&mode=${mode}`), { signal })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json() as Promise<ScopResponse>
        })
        .then((body) => {
          if (signal.aborted) return
          setData(body)
          setError(null)
        })
        .catch((e: unknown) => {
          if (signal.aborted) return
          if (e instanceof DOMException && e.name === 'AbortError') return
          setError(e instanceof Error ? e.message : 'Fetch failed')
        })
        .finally(() => {
          if (!signal.aborted) setLoading(false)
        })
    },
    [window, mode],
  )

  useEffect(() => {
    const controller = new AbortController()
    fetchData(controller.signal)
    return () => controller.abort()
  }, [fetchData])

  return { data, loading, error }
}
