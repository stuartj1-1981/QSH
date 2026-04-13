import { useState, useEffect } from 'react'
import { apiUrl } from '../lib/api'
import type { Driver } from '../types/config'

interface ResolvedEntity {
  friendly_name: string
  state: string
  unit: string
}

/**
 * Resolve a batch of HA entity IDs to their friendly names.
 * Automatically fetches when entityIds changes.
 * Returns a map of entity_id → ResolvedEntity.
 *
 * When driver is 'mqtt' the hook is a no-op — the /api/entities/resolve
 * endpoint returns 501 on MQTT installs so there is no point calling it.
 */
export function useEntityResolve(entityIds: string[], driver?: Driver) {
  const [resolved, setResolved] = useState<Record<string, ResolvedEntity>>({})
  const [loading, setLoading] = useState(false)
  // Stable string key so the effect only re-runs when the actual set of IDs changes
  const key = entityIds.filter(Boolean).sort().join(',')

  useEffect(() => {
    if (!key || driver === 'mqtt') {
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
  }, [key, driver])

  return { resolved, loading }
}
