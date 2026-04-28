import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { AwayStateResponse } from '../types/schedule'

export function useAwayState() {
  const [data, setData] = useState<AwayStateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(() => {
    fetch(apiUrl('api/away'))
      .then(async (r) => {
        const body: unknown = await r.json().catch(() => null)
        if (!r.ok) {
          const detail =
            body && typeof body === 'object' && 'detail' in body && typeof (body as { detail: unknown }).detail === 'string'
              ? (body as { detail: string }).detail
              : null
          setError(detail !== null ? `${r.status}: ${detail}` : String(r.status))
          return
        }
        if (
          !body ||
          typeof body !== 'object' ||
          typeof (body as { whole_house?: unknown }).whole_house !== 'object' ||
          (body as { whole_house?: unknown }).whole_house === null ||
          typeof (body as { per_zone?: unknown }).per_zone !== 'object' ||
          (body as { per_zone?: unknown }).per_zone === null ||
          typeof (body as { recovery?: unknown }).recovery !== 'object' ||
          (body as { recovery?: unknown }).recovery === null
        ) {
          setError('Unexpected /api/away response shape')
          return
        }
        setData(body as AwayStateResponse)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
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
