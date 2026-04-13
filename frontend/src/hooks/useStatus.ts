import { useEffect, useState, useCallback } from 'react'
import type { StatusResponse } from '../types/api'
import { apiUrl } from '../lib/api'

export function useStatus() {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(() => {
    fetch(apiUrl('api/status'))
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    fetchStatus()
    // Poll every 10s so the driver error banner appears promptly
    // when the API comes up in degraded mode.
    const id = setInterval(fetchStatus, 10_000)
    return () => clearInterval(id)
  }, [fetchStatus])

  return { data, error }
}
