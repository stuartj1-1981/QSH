// Driver-agnostic: this hook exposes no HA entity IDs or MQTT topics.
/**
 * Reads `GET /api/historian/setup` (INSTRUCTION-524A T1), which answers in
 * every state — no historian, historian off, not yet started, store open.
 *
 * It never polls. The panel reads it on mount, on `refresh()` after a save,
 * and once more through `fetchNow()` immediately before a save, so a write
 * is decided on a state read at the moment of writing (INSTRUCTION-524B T3).
 */
import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from '../lib/api'
import type { HistorianSetupResponse } from '../types/api'

export interface UseHistorianSetupResult {
  data: HistorianSetupResponse | null
  loading: boolean
  error: string | null
  refresh: () => void
  fetchNow: () => Promise<HistorianSetupResponse | null>
}

export function useHistorianSetup(): UseHistorianSetupResult {
  const [data, setData] = useState<HistorianSetupResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    setLoading(true)
    fetch(apiUrl('api/historian/setup'), { signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<HistorianSetupResponse>
      })
      .then((body) => {
        if (signal.aborted) return
        setData(body)
        setError(null)
      })
      .catch((e: unknown) => {
        if (signal.aborted) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Fetch failed')
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [tick])

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  /** One read, right now. Resolves `null` on any failure — the caller then
   *  sends nothing rather than writing on a state it could not confirm. */
  const fetchNow = useCallback(async (): Promise<HistorianSetupResponse | null> => {
    try {
      const resp = await fetch(apiUrl('api/historian/setup'))
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const body = (await resp.json()) as HistorianSetupResponse
      setData(body)
      setError(null)
      return body
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Fetch failed')
      return null
    }
  }, [])

  return { data, loading, error, refresh, fetchNow }
}
