import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { SourceSelectionState } from '../types/api'

export function useSourceSelection(live: SourceSelectionState | undefined) {
  const [data, setData] = useState<SourceSelectionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Initial fetch
  useEffect(() => {
    fetch(apiUrl('api/source-selection'))
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
      })
      .then((d: SourceSelectionState) => {
        // Single-source installs return {error: "..."} — ignore
        if (d && 'sources' in d) setData(d)
        setLoading(false)
      })
      .catch(e => { setError(e instanceof Error ? e.message : 'Failed'); setLoading(false) })
  }, [])

  // Update from WebSocket live data
  useEffect(() => {
    if (live) setData(live)
  }, [live])

  const setMode = useCallback(async (mode: string) => {
    try {
      const res = await fetch(apiUrl('api/source-selection/mode'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const updated = await res.json() as Partial<SourceSelectionState>
      setData(prev => prev ? { ...prev, ...updated } : prev)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set mode')
    }
  }, [])

  const setPreference = useCallback(async (preference: number) => {
    try {
      const res = await fetch(apiUrl('api/source-selection/preference'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preference }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const updated = await res.json() as Partial<SourceSelectionState>
      setData(prev => prev ? { ...prev, ...updated } : prev)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set preference')
    }
  }, [])

  return { data, loading, error, setMode, setPreference }
}
