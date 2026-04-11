import { useState, useEffect } from 'react'
import { apiUrl } from '../lib/api'

interface ResolvedEntity {
  friendly_name: string
  state: string
  unit: string
}

/**
 * Resolve a batch of HA entity IDs to their friendly names.
 * Automatically fetches when entityIds changes.
 * Returns a map of entity_id → ResolvedEntity.
 */
export function useEntityResolve(entityIds: string[]) {
  const [resolved, setResolved] = useState<Record<string, ResolvedEntity>>({})
  const [loading, setLoading] = useState(false)
  // Stable string key so the effect only re-runs when the actual set of IDs changes
  const key = entityIds.filter(Boolean).sort().join(',')

  useEffect(() => {
    if (!key) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when input clears is intentional
      setResolved({})
      return
    }

    let cancelled = false
    const ids = key.split(',')
    setLoading(true)

    fetch(apiUrl('api/entities/resolve'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_ids: ids }),
    })
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        return resp.json()
      })
      .then((data: { entities?: Record<string, ResolvedEntity> }) => {
        if (!cancelled) setResolved(data.entities || {})
      })
      .catch(() => {
        // Silently fail — entity fields still show the raw ID
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [key])

  return { resolved, loading }
}
