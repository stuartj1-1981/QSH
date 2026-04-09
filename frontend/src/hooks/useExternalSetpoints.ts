import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { ExternalSetpoints } from '../types/config'

export function useExternalSetpoints() {
  const [data, setData] = useState<ExternalSetpoints | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const refetchSetpoints = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(apiUrl('api/control/external-setpoints'))
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json: ExternalSetpoints = await resp.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refetchSetpoints() }, [refetchSetpoints])

  const save = useCallback(async (updates: Partial<ExternalSetpoints>) => {
    setSaving(true)
    setError(null)
    try {
      const resp = await fetch(apiUrl('api/control/external-setpoints'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${resp.status}`)
      }
      await refetchSetpoints()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [refetchSetpoints])

  return { data, loading, error, saving, save, refetch: refetchSetpoints }
}
