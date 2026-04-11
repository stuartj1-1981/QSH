import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { ComfortScheduleResponse, ComfortPeriod } from '../types/schedule'

export function useComfortSchedule() {
  const [data, setData] = useState<ComfortScheduleResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(() => {
    setLoading(true)
    fetch(apiUrl('api/comfort-schedule'))
      .then((r) => r.json())
      .then((d: ComfortScheduleResponse) => { setData(d); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
  useEffect(() => { refetch() }, [refetch])

  return { data, error, loading, refetch }
}

export function useUpdateComfortSchedule() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = useCallback(
    async (enabled: boolean, periods: ComfortPeriod[]) => {
      setLoading(true)
      setError(null)
      try {
        const resp = await fetch(apiUrl('api/comfort-schedule'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, periods }),
        })
        if (!resp.ok) {
          const err = await resp.json()
          throw new Error(err.detail || 'Update failed')
        }
        return await resp.json()
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error'
        setError(msg)
        throw e
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const setEnabled = useCallback(async (enabled: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(apiUrl('api/comfort-schedule/enabled'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || 'Toggle failed')
      }
      return await resp.json()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setError(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  return { update, setEnabled, loading, error }
}
