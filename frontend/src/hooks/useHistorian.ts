import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type {
  HistorianMeasurementsResponse,
  HistorianQueryResponse,
  HistorianTagsResponse,
  HistorianFieldsResponse,
} from '../types/api'

interface UseHistorianMeasurementsResult {
  data: HistorianMeasurementsResponse | null
  loading: boolean
  error: string | null
}

export function useHistorianMeasurements(): UseHistorianMeasurementsResult {
  const [data, setData] = useState<HistorianMeasurementsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    fetch(apiUrl('api/historian/measurements'), { signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        setData(json)
        setLoading(false)
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Fetch failed')
        setLoading(false)
      })

    return () => controller.abort()
  }, [])

  return { data, loading, error }
}

interface UseHistorianQueryResult {
  data: HistorianQueryResponse | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useHistorianQuery(
  measurement: string,
  fields: string[],
  options: {
    room?: string
    timeFrom?: string
    timeTo?: string
    interval?: string
    aggregation?: string
  } = {},
): UseHistorianQueryResult {
  const [data, setData] = useState<HistorianQueryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState(0)

  const fieldsKey = fields.join(',')
  const { room, timeFrom = '-24h', timeTo = 'now()', interval = '5m', aggregation = 'mean' } = options

  const refetch = useCallback(() => setTrigger((n) => n + 1), [])

  const doFetch = useCallback((
    m: string,
    fk: string,
    r: string | undefined,
    tf: string,
    tt: string,
    iv: string,
    ag: string,
    signal: AbortSignal,
  ) => {
    const params = new URLSearchParams({
      measurement: m,
      field: fk,
      from: tf,
      to: tt,
      interval: iv,
      aggregation: ag,
    })
    if (r) params.set('room', r)

    return fetch(apiUrl(`api/historian/query?${params}`), { signal })
      .then((resp) => resp.json())
      .then((json) => {
        setData(json)
        setError(json.error ?? null)
        setLoading(false)
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Fetch failed')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!measurement || !fieldsKey) return

    const controller = new AbortController()
    // Use ref trick: schedule loading via microtask to avoid synchronous setState in effect
    queueMicrotask(() => setLoading(true))
    doFetch(measurement, fieldsKey, room, timeFrom, timeTo, interval, aggregation, controller.signal)

    return () => controller.abort()
  }, [measurement, fieldsKey, room, timeFrom, timeTo, interval, aggregation, trigger, doFetch])

  return { data, loading, error, refetch }
}

interface UseHistorianTagsResult {
  rooms: string[]
  loading: boolean
}

export function useHistorianTags(measurement: string): UseHistorianTagsResult {
  const [rooms, setRooms] = useState<string[]>([])
  const [loading, setLoading] = useState(() => Boolean(measurement))

  useEffect(() => {
    if (!measurement) return

    const controller = new AbortController()

    fetch(apiUrl(`api/historian/tags?measurement=${measurement}`), { signal: controller.signal })
      .then((r) => r.json())
      .then((json: HistorianTagsResponse) => {
        setRooms(json.tags?.room ?? [])
        setLoading(false)
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setLoading(false)
      })

    return () => controller.abort()
  }, [measurement])

  return { rooms, loading }
}

interface UseHistorianFieldsResult {
  fields: string[]
  loading: boolean
}

export function useHistorianFields(measurement: string): UseHistorianFieldsResult {
  const [fields, setFields] = useState<string[]>([])
  const [loading, setLoading] = useState(() => Boolean(measurement))

  useEffect(() => {
    if (!measurement) return

    const controller = new AbortController()

    fetch(apiUrl(`api/historian/fields?measurement=${measurement}`), { signal: controller.signal })
      .then((r) => r.json())
      .then((json: HistorianFieldsResponse) => {
        setFields(json.fields ?? [])
        setLoading(false)
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setLoading(false)
      })

    return () => controller.abort()
  }, [measurement])

  return { fields, loading }
}
