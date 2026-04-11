import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { AwayStateResponse } from '../types/schedule'

export function useAwayState() {
  const [data, setData] = useState<AwayStateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(() => {
    fetch(apiUrl('api/away'))
      .then((r) => r.json())
      .then((d) => { setData(d); setError(null) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refetch()
    const interval = setInterval(refetch, 30_000)
    return () => clearInterval(interval)
  }, [refetch])

  return { data, error, loading, refetch }
}

export function useSetAway() {
  const [loading, setLoading] = useState(false)

  const setAway = useCallback(async (params: { active: boolean; days?: number }) => {
    setLoading(true)
    try {
      const resp = await fetch(apiUrl('api/away'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      return await resp.json()
    } finally {
      setLoading(false)
    }
  }, [])

  return { setAway, loading }
}

export function useSetZoneAway() {
  const [loading, setLoading] = useState(false)

  const setZoneAway = useCallback(
    async (room: string, active: boolean, days?: number) => {
      setLoading(true)
      try {
        const resp = await fetch(apiUrl(`api/away/${room}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active, days }),
        })
        return await resp.json()
      } finally {
        setLoading(false)
      }
    },
    []
  )

  return { setZoneAway, loading }
}
