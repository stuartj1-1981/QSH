import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { apiUrl } from '../lib/api'
import { usePatchConfig } from './useConfig'
import type {
  StoreStatsResponse,
  SealedDaysResponse,
  ParityIndexResponse,
  ParityReport,
  StoreSqlResponse,
} from '../types/api'
import type { HistorianYaml, StoreYaml } from '../types/config'

// INSTRUCTION-510B commitment 2 — 10 s while a migration is actively moving
// data, 60 s otherwise. `/days` and `/parity` are fetched on mount and on
// explicit refresh only (commitment 2); they do not poll.
const FAST_POLL_MS = 10_000
const SLOW_POLL_MS = 60_000

function pollIntervalFor(data: StoreStatsResponse | null): number {
  const stats = data?.stats
  if (!stats) return SLOW_POLL_MS
  if (stats.migration_state === 'backfill') return FAST_POLL_MS
  if (stats.backfill_state === 'pulling' || stats.backfill_state === 'enumerating') {
    return FAST_POLL_MS
  }
  return SLOW_POLL_MS
}

interface UseStoreStatsResult {
  data: StoreStatsResponse | null
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useStoreStats(): UseStoreStatsResult {
  const [data, setData] = useState<StoreStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState(0)

  const refresh = useCallback(() => setTrigger((n) => n + 1), [])

  const fetchOnce = useCallback((signal: AbortSignal) => {
    return fetch(apiUrl('api/historian/store'), { signal })
      .then((r) => {
        if (!r.ok) throw new Error(`GET /api/historian/store failed: ${r.status}`)
        return r.json()
      })
      .then((json: StoreStatsResponse) => {
        setData(json)
        setError(null)
        setLoading(false)
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Fetch failed')
        setLoading(false)
      })
  }, [])

  // Fetches on mount and whenever an explicit refresh is requested.
  useEffect(() => {
    const controller = new AbortController()
    fetchOnce(controller.signal)
    return () => controller.abort()
  }, [fetchOnce, trigger])

  // The interval is derived from the last response. This effect's
  // dependency is the derived number, not `data` itself, so it re-subscribes
  // only when the interval actually changes rather than on every response.
  const intervalMs = useMemo(() => pollIntervalFor(data), [data])

  useEffect(() => {
    const controller = new AbortController()
    const id = setInterval(() => {
      fetchOnce(controller.signal)
    }, intervalMs)
    return () => {
      clearInterval(id)
      controller.abort()
    }
  }, [intervalMs, fetchOnce])

  return { data, loading, error, refresh }
}

interface UseSealedDaysResult {
  data: SealedDaysResponse | null
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useSealedDays(
  measurement?: string,
  limit: number = 100,
  offset: number = 0,
): UseSealedDaysResult {
  const [data, setData] = useState<SealedDaysResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState(0)

  const refresh = useCallback(() => setTrigger((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => setLoading(true))
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (measurement) params.set('measurement', measurement)
    fetch(apiUrl(`api/historian/days?${params}`), { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`GET /api/historian/days failed: ${r.status}`)
        return r.json()
      })
      .then((json: SealedDaysResponse) => {
        setData(json)
        setError(null)
        setLoading(false)
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Fetch failed')
        setLoading(false)
      })
    return () => controller.abort()
  }, [measurement, limit, offset, trigger])

  return { data, loading, error, refresh }
}

export type ParityDayResult =
  | { kind: 'ok'; report: ParityReport }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string }

interface UseParityResult {
  index: ParityIndexResponse | null
  loading: boolean
  error: string | null
  refreshIndex: () => void
  loadDay: (day: string) => Promise<ParityDayResult>
}

export function useParity(): UseParityResult {
  const [index, setIndex] = useState<ParityIndexResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState(0)
  const dayControllerRef = useRef<AbortController | null>(null)

  const refreshIndex = useCallback(() => setTrigger((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => setLoading(true))
    fetch(apiUrl('api/historian/parity'), { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`GET /api/historian/parity failed: ${r.status}`)
        return r.json()
      })
      .then((json: ParityIndexResponse) => {
        setIndex(json)
        setError(null)
        setLoading(false)
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Fetch failed')
        setLoading(false)
      })
    return () => controller.abort()
  }, [trigger])

  // Unmount-safety for the imperative loadDay() calls below, which are not
  // tied to a render-driven effect of their own.
  useEffect(() => {
    return () => {
      dayControllerRef.current?.abort()
    }
  }, [])

  const loadDay = useCallback(async (day: string): Promise<ParityDayResult> => {
    dayControllerRef.current?.abort()
    const controller = new AbortController()
    dayControllerRef.current = controller
    try {
      const res = await fetch(apiUrl(`api/historian/parity?day=${encodeURIComponent(day)}`), {
        signal: controller.signal,
      })
      if (res.status === 404) return { kind: 'notFound' }
      if (!res.ok) return { kind: 'error', message: `HTTP ${res.status}` }
      const json = await res.json()
      return { kind: 'ok', report: json.report as ParityReport }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return { kind: 'error', message: 'aborted' }
      }
      return { kind: 'error', message: e instanceof Error ? e.message : 'Fetch failed' }
    }
  }, [])

  return { index, loading, error, refreshIndex, loadDay }
}

// ---------------------------------------------------------------------
// INSTRUCTION-510C — the Store page's three acts.
// ---------------------------------------------------------------------

interface UseStoreConfigResult {
  data: HistorianYaml | null
  loading: boolean
  error: string | null
  saving: boolean
  saved: boolean
  save: (storePatch: Partial<StoreYaml>) => Promise<boolean>
}

// Commitment 8 / OB-6 — the `historian` PATCH is a full-section overwrite
// (routes/config.py `restore_redacted`: it iterates `incoming.items()`
// only). This hook holds the whole section as loaded from
// `GET /api/config/raw` and merges the panel's store edits into it before
// every save, so no other historian key is ever dropped. It refuses to
// save while the section has not loaded — a fallback default object is
// exactly the shape that drops keys (§1.2).
export function useStoreConfig(): UseStoreConfigResult {
  const [data, setData] = useState<HistorianYaml | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const { patch, saving, error: patchError } = usePatchConfig()

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => setLoading(true))
    fetch(apiUrl('api/config/raw'), { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`GET /api/config/raw failed: ${r.status}`)
        return r.json()
      })
      .then((json: { historian?: HistorianYaml }) => {
        setData(json.historian ?? null)
        setLoadError(null)
        setLoading(false)
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setLoadError(e instanceof Error ? e.message : 'Fetch failed')
        setLoading(false)
      })
    return () => controller.abort()
  }, [])

  const save = useCallback(
    async (storePatch: Partial<StoreYaml>): Promise<boolean> => {
      setSaved(false)
      if (data === null) {
        setLoadError('historian section has not loaded — refusing to save')
        return false
      }
      // The complete section, store sub-block merged (commitment 8). Every
      // other historian key rides through unchanged, including a redacted
      // `password` sentinel — restore_redacted (routes/config.py) resolves
      // that back to the on-disk value server-side (§1.3, OB-3).
      const merged: HistorianYaml = {
        ...data,
        store: { ...(data.store ?? {}), ...storePatch },
      }
      const result = await patch('historian', merged)
      if (result) {
        setData(merged)
        setSaved(true)
        return true
      }
      return false
    },
    [data, patch],
  )

  return { data, loading, error: loadError ?? patchError, saving, saved, save }
}

export type CutoverOutcome =
  | { kind: 'ok'; state: string; gap_days: number | 'unknown'; forced: boolean }
  | { kind: 'refused'; unreconciled_days: number | 'unknown'; source_last_error: string | null }
  | { kind: 'error'; message: string }

interface UseCutoverResult {
  requesting: boolean
  result: CutoverOutcome | null
  request: () => Promise<CutoverOutcome>
}

// OB-1 — the body is `{}` on every call. This hook accepts no `force`
// parameter at all; the UI does not offer it (commitment 1).
export function useCutover(): UseCutoverResult {
  const [requesting, setRequesting] = useState(false)
  const [result, setResult] = useState<CutoverOutcome | null>(null)

  const request = useCallback(async (): Promise<CutoverOutcome> => {
    setRequesting(true)
    try {
      const resp = await fetch(apiUrl('api/historian/migration/cutover'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (resp.status === 409) {
        const body = await resp.json().catch(() => ({ detail: {} }))
        const detail = body?.detail ?? {}
        const outcome: CutoverOutcome = {
          kind: 'refused',
          unreconciled_days: detail.unreconciled_days ?? 'unknown',
          source_last_error: detail.source_last_error ?? null,
        }
        setResult(outcome)
        return outcome
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        const outcome: CutoverOutcome = {
          kind: 'error',
          message: body?.detail ?? `HTTP ${resp.status}`,
        }
        setResult(outcome)
        return outcome
      }
      const json = await resp.json()
      const outcome: CutoverOutcome = {
        kind: 'ok',
        state: json.state,
        gap_days: json.gap_days,
        forced: json.forced,
      }
      setResult(outcome)
      return outcome
    } catch (e) {
      const outcome: CutoverOutcome = {
        kind: 'error',
        message: e instanceof Error ? e.message : 'Network error',
      }
      setResult(outcome)
      return outcome
    } finally {
      setRequesting(false)
    }
  }, [])

  return { requesting, result, request }
}

export type SqlOutcome =
  | { kind: 'ok'; response: StoreSqlResponse }
  | { kind: 'badRequest'; message: string }
  | { kind: 'busy'; message: string }
  | { kind: 'timeout'; message: string }
  | { kind: 'error'; message: string }

interface UseStoreSqlResult {
  running: boolean
  outcome: SqlOutcome | null
  run: (sql: string) => Promise<void>
}

// Commitment 5 — no client-side "is this a SELECT" check. The text is
// sent as written and the server's verdict is rendered (commitment 6):
// 400 (not a single SELECT), 429 (one query at a time), 504 (interrupted
// at the timeout), each its own outcome kind.
export function useStoreSql(): UseStoreSqlResult {
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<SqlOutcome | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  const run = useCallback(async (sql: string) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setRunning(true)
    try {
      const resp = await fetch(apiUrl('api/historian/sql'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: sql }),
        signal: controller.signal,
      })
      const body = await resp.json().catch(() => ({}))
      if (resp.ok) {
        setOutcome({ kind: 'ok', response: body as StoreSqlResponse })
        return
      }
      const message = body?.error ?? `HTTP ${resp.status}`
      if (resp.status === 400) {
        setOutcome({ kind: 'badRequest', message })
      } else if (resp.status === 429) {
        setOutcome({ kind: 'busy', message })
      } else if (resp.status === 504) {
        setOutcome({ kind: 'timeout', message })
      } else {
        setOutcome({ kind: 'error', message })
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setOutcome({ kind: 'error', message: e instanceof Error ? e.message : 'Network error' })
    } finally {
      setRunning(false)
    }
  }, [])

  return { running, outcome, run }
}
