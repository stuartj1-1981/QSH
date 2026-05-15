import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl } from '../lib/api'
import type { ManualEntry } from '../types/api'

export interface UseManualResult {
  entries: ManualEntry[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  setManual: (room: string, position_pct: number) => Promise<void>
  setAuto: (room: string) => Promise<void>
}

/**
 * Manual override slow-path: REST API for AUTO/MANUAL transitions.
 *
 * For per-cycle live position display, consumers should read `manual_state`
 * off the WebSocket cycle snapshot (useLive). This hook owns the slow-path
 * list + mutations.
 *
 * INSTRUCTION-225D V4 D2: `setManual` sends `set_by: 'engineering_ui'` so
 * UI-originated commands are distinguishable from direct curl / future
 * automation callers in the audit trail.
 */
export function useManual(): UseManualResult {
  const [entries, setEntries] = useState<ManualEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const res = await fetch(apiUrl('api/manual'), { signal: ac.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as ManualEntry[]
      setEntries(body)
      setError(null)
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    return () => {
      abortRef.current?.abort()
    }
  }, [refresh])

  const setManual = useCallback(
    async (room: string, position_pct: number): Promise<void> => {
      // Optimistic update.
      const previous = entries
      const now = Date.now() / 1000
      setEntries((prev) => {
        const next = prev.map((e) =>
          e.room === room
            ? { ...e, mode: 'MANUAL' as const, position_pct, set_by: 'engineering_ui', set_at: now }
            : e,
        )
        return next
      })
      try {
        const res = await fetch(apiUrl(`api/manual/${encodeURIComponent(room)}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'MANUAL', position_pct, set_by: 'engineering_ui' }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { detail?: string }
          throw new Error(body.detail ?? `HTTP ${res.status}`)
        }
        const confirmed = (await res.json()) as ManualEntry
        setEntries((prev) => prev.map((e) => (e.room === room ? confirmed : e)))
        setError(null)
      } catch (e: unknown) {
        setEntries(previous)
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [entries],
  )

  const setAuto = useCallback(
    async (room: string): Promise<void> => {
      const previous = entries
      // Optimistic update — return to AUTO sentinel.
      setEntries((prev) =>
        prev.map((e) =>
          e.room === room
            ? { ...e, mode: 'AUTO' as const, position_pct: null, set_by: 'startup_default', set_at: 0 }
            : e,
        ),
      )
      try {
        const res = await fetch(apiUrl(`api/manual/${encodeURIComponent(room)}`), {
          method: 'DELETE',
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { detail?: string }
          throw new Error(body.detail ?? `HTTP ${res.status}`)
        }
        const confirmed = (await res.json()) as ManualEntry
        setEntries((prev) => prev.map((e) => (e.room === room ? confirmed : e)))
        setError(null)
      } catch (e: unknown) {
        setEntries(previous)
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [entries],
  )

  return { entries, loading, error, refresh, setManual, setAuto }
}
