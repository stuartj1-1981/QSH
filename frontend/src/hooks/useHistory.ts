import { useState, useEffect } from 'react'
import { apiUrl } from '../lib/api'

export interface HistoryPoint {
  t: number
  [key: string]: number | string | null
}

interface UseHistoryResult {
  data: HistoryPoint[]
  loading: boolean
}

export function useHistory(metrics: string[], hours: number): UseHistoryResult {
  const [data, setData] = useState<HistoryPoint[]>([])
  const [loading, setLoading] = useState(true)
  const metricsKey = metrics.join(',')

  useEffect(() => {
    let cancelled = false

    const fetchData = async () => {
      try {
        const resp = await fetch(apiUrl(`api/history?hours=${hours}&metrics=${metricsKey}`))
        if (!resp.ok) return
        const json = await resp.json()
        if (!cancelled) {
          setData(json.entries ?? [])
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [metricsKey, hours])

  return { data, loading }
}

export interface RoomHistoryData {
  [room: string]: HistoryPoint[]
}

interface UseRoomHistoryResult {
  data: RoomHistoryData
  loading: boolean
}

export function useRoomHistory(fields: string[], hours: number): UseRoomHistoryResult {
  const [data, setData] = useState<RoomHistoryData>({})
  const [loading, setLoading] = useState(true)
  const fieldsKey = fields.join(',')

  useEffect(() => {
    let cancelled = false

    const fetchData = async () => {
      try {
        const resp = await fetch(apiUrl(`api/history/rooms?hours=${hours}&fields=${fieldsKey}`))
        if (!resp.ok) return
        const json = await resp.json()
        if (!cancelled) {
          setData(json.rooms ?? {})
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [fieldsKey, hours])

  return { data, loading }
}
