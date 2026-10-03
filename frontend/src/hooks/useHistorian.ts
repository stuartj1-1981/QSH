import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type {
  HistorianMeasurementsResponse,
  HistorianQueryResponse,
  HistorianEventsResponse,
  HistorianTagsResponse,
  HistorianFieldsResponse,
  HistorianFieldClass,
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
    hwActive?: 'true' | 'false'
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
  const { room, hwActive, timeFrom = '-24h', timeTo = 'now()', interval = '5m', aggregation = 'mean' } = options

  const refetch = useCallback(() => setTrigger((n) => n + 1), [])

  const doFetch = useCallback((
    m: string,
    fk: string,
    r: string | undefined,
    hw: 'true' | 'false' | undefined,
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
    if (hw) params.set('hw_active', hw)

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
    doFetch(measurement, fieldsKey, room, hwActive, timeFrom, timeTo, interval, aggregation, controller.signal)

    return () => controller.abort()
  }, [measurement, fieldsKey, room, hwActive, timeFrom, timeTo, interval, aggregation, trigger, doFetch])

  return { data, loading, error, refetch }
}

interface UseHistorianEventsResult {
  data: HistorianEventsResponse | null
  loading: boolean
  error: string | null
  refetch: () => void
}

// A refused request (400) carries its reason as a string `detail`; any other
// body, or one that does not parse, has none.
function eventsErrorDetail(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'detail' in body) {
    return typeof body.detail === 'string' ? body.detail : null
  }
  return null
}

// INSTRUCTION-565D — the raw records of an event measurement with their tag
// values. The effect is keyed on the option values, not on the options
// object, so a caller passing a new literal on each render fetches once.
export function useHistorianEvents(
  measurement: string,
  options: { room?: string; controller?: string; timeFrom?: string } = {},
): UseHistorianEventsResult {
  const [data, setData] = useState<HistorianEventsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState(0)

  const { room, controller, timeFrom = '-7d' } = options

  const refetch = useCallback(() => setTrigger((n) => n + 1), [])

  const doFetch = useCallback((
    m: string,
    tf: string,
    r: string | undefined,
    c: string | undefined,
    signal: AbortSignal,
  ) => {
    const params = new URLSearchParams({ measurement: m, from: tf })
    // The route refuses an empty filter value, so an empty string is not sent.
    if (r) params.set('room', r)
    if (c) params.set('controller', c)

    return fetch(apiUrl(`api/historian/events?${params}`), { signal })
      .then((resp) => {
        if (resp.ok) {
          return resp.json().then((json: HistorianEventsResponse) => {
            setData(json)
            setError(json.error ?? null)
            setLoading(false)
          })
        }
        return resp.json()
          .catch((e: unknown) => {
            if (e instanceof DOMException && e.name === 'AbortError') throw e
            return null
          })
          .then((body: unknown) => {
            setData(null)
            setError(eventsErrorDetail(body) ?? `HTTP ${resp.status}`)
            setLoading(false)
          })
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Fetch failed')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!measurement) return

    const abortController = new AbortController()
    // Loading is set through a microtask, as in useHistorianQuery, to avoid a
    // synchronous setState in the effect.
    queueMicrotask(() => setLoading(true))
    doFetch(measurement, timeFrom, room, controller, abortController.signal)

    return () => abortController.abort()
  }, [measurement, timeFrom, room, controller, trigger, doFetch])

  return { data, loading, error, refetch }
}

interface UseHistorianTagsResult {
  rooms: string[]
  // INSTRUCTION-224E — emitter tag values surfaced from /api/historian/tags
  // for the qsh_emitter measurement (and any future measurement carrying the
  // emitter tag). Empty for measurements without an emitter tag.
  emitters: string[]
  loading: boolean
}

export function useHistorianTags(measurement: string): UseHistorianTagsResult {
  const [rooms, setRooms] = useState<string[]>([])
  const [emitters, setEmitters] = useState<string[]>([])
  const [loading, setLoading] = useState(() => Boolean(measurement))

  useEffect(() => {
    if (!measurement) return

    const controller = new AbortController()

    fetch(apiUrl(`api/historian/tags?measurement=${measurement}`), { signal: controller.signal })
      .then((r) => r.json())
      .then((json: HistorianTagsResponse) => {
        setRooms(json.tags?.room ?? [])
        setEmitters(json.tags?.emitter ?? [])
        setLoading(false)
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setLoading(false)
      })

    return () => controller.abort()
  }, [measurement])

  return { rooms, emitters, loading }
}

interface UseHistorianFieldsResult {
  fields: string[]
  // INSTRUCTION-541B — empty on a backend that does not report classes (D1).
  fieldTypes: Record<string, HistorianFieldClass>
  loading: boolean
}

export function useHistorianFields(measurement: string): UseHistorianFieldsResult {
  const [fields, setFields] = useState<string[]>([])
  const [fieldTypes, setFieldTypes] = useState<Record<string, HistorianFieldClass>>({})
  const [loading, setLoading] = useState(() => Boolean(measurement))

  useEffect(() => {
    if (!measurement) return

    const controller = new AbortController()

    fetch(apiUrl(`api/historian/fields?measurement=${measurement}`), { signal: controller.signal })
      .then((r) => r.json())
      .then((json: HistorianFieldsResponse) => {
        setFields(json.fields ?? [])
        setFieldTypes(json.field_types ?? {})
        setLoading(false)
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setLoading(false)
      })

    return () => controller.abort()
  }, [measurement])

  return { fields, fieldTypes, loading }
}
