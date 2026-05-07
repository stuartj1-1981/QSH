import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type {
  DiffEntry,
  DiffResponse,
  RevertResponse,
  SnapshotsResponse,
} from '../types/api'

/**
 * Snapshot list hook (INSTRUCTION-192). Polls /api/config/snapshots and
 * provides imperative actions for diff, revert, and purge. All actions
 * refresh the list after success so the panel reflects the new state.
 */
export function useSnapshots() {
  const [data, setData] = useState<SnapshotsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSnapshots = useCallback(() => {
    fetch(apiUrl('api/config/snapshots'))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: SnapshotsResponse) => {
        setData(d)
        setError(null)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchSnapshots()
  }, [fetchSnapshots])

  const fetchDiff = useCallback(
    async (snapshotId: string): Promise<DiffEntry[]> => {
      const res = await fetch(
        apiUrl(`api/config/snapshots/${encodeURIComponent(snapshotId)}/diff`),
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const detail =
          typeof body === 'object' && body !== null && 'detail' in body
            ? (body as { detail: string }).detail
            : `HTTP ${res.status}`
        throw new Error(detail)
      }
      const json = (await res.json()) as DiffResponse
      return json.entries
    },
    [],
  )

  const revert = useCallback(
    async (snapshotId: string, confirmTimestamp: string): Promise<RevertResponse> => {
      const res = await fetch(
        apiUrl(`api/config/snapshots/${encodeURIComponent(snapshotId)}/revert`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm_timestamp: confirmTimestamp }),
        },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const detail =
          typeof body === 'object' && body !== null && 'detail' in body
            ? (body as { detail: string }).detail
            : `HTTP ${res.status}`
        throw new Error(detail)
      }
      const json = (await res.json()) as RevertResponse
      fetchSnapshots()
      return json
    },
    [fetchSnapshots],
  )

  const purge = useCallback(async (): Promise<number> => {
    const res = await fetch(apiUrl('api/config/snapshots/purge'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'PURGE_ALL' }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const detail =
        typeof body === 'object' && body !== null && 'detail' in body
          ? (body as { detail: string }).detail
          : `HTTP ${res.status}`
      throw new Error(detail)
    }
    const json = (await res.json()) as { count: number }
    fetchSnapshots()
    return json.count
  }, [fetchSnapshots])

  return {
    data,
    error,
    loading,
    refetch: fetchSnapshots,
    fetchDiff,
    revert,
    purge,
  }
}
