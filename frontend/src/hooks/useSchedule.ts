import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { SchedulesResponse, WeekSchedule } from '../types/schedule'

export function useSchedules() {
  const [data, setData] = useState<SchedulesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(() => {
    setLoading(true)
    fetch(apiUrl('api/schedule'))
      .then((r) => r.json())
      .then((d: SchedulesResponse) => { setData(d); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
  useEffect(() => { refetch() }, [refetch])

  return { data, error, loading, refetch }
}

export function useUpdateSchedule() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = useCallback(
    async (room: string, schedule: WeekSchedule, enabled?: boolean) => {
      setLoading(true)
      setError(null)
      try {
        const body: Record<string, unknown> = { schedule }
        if (enabled !== undefined) body.enabled = enabled
        const resp = await fetch(apiUrl(`api/schedule/${room}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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

  return { update, loading, error }
}

export function useApplyPreset() {
  const [loading, setLoading] = useState(false)

  const apply = useCallback(async (room: string, preset: string) => {
    setLoading(true)
    try {
      const resp = await fetch(apiUrl(`api/schedule/${room}/preset`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset }),
      })
      return await resp.json()
    } finally {
      setLoading(false)
    }
  }, [])

  return { apply, loading }
}

export function useCopySchedule() {
  const [loading, setLoading] = useState(false)

  const copy = useCallback(async (room: string, targetRooms: string[]) => {
    setLoading(true)
    try {
      const resp = await fetch(apiUrl(`api/schedule/${room}/copy`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_rooms: targetRooms }),
      })
      return await resp.json()
    } finally {
      setLoading(false)
    }
  }, [])

  return { copy, loading }
}
