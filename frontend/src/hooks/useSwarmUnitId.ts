import { useEffect, useState } from 'react'
import { apiUrl } from '../lib/api'
import type { SwarmStatus } from '../types/api'

export interface SwarmUnitId {
  unitId: string | null
  failed: boolean
}

function hasUnitId(d: unknown): d is Pick<SwarmStatus, 'unit_id'> {
  if (typeof d !== 'object' || d === null || !('unit_id' in d)) return false
  return d.unit_id === null || typeof d.unit_id === 'string'
}

// INSTRUCTION-570C — the swarm unit ID, which the user gives in a data
// request. unitId is null when the install has no swarm identity. failed is
// true when the local read gave no usable answer.
export function useSwarmUnitId(): SwarmUnitId {
  const [state, setState] = useState<SwarmUnitId>({ unitId: null, failed: false })
  useEffect(() => {
    let live = true
    fetch(apiUrl('api/swarm/status'))
      .then((r) => r.json())
      .then((d: unknown) => {
        if (!live) return
        if (hasUnitId(d)) {
          setState({ unitId: d.unit_id || null, failed: false })
        } else {
          setState({ unitId: null, failed: true })
        }
      })
      .catch(() => {
        if (live) setState({ unitId: null, failed: true })
      })
    return () => {
      live = false
    }
  }, [])
  return state
}
