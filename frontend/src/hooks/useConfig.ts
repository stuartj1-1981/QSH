import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { QshConfigYaml } from '../types/config'

/** Fetch the raw YAML config for settings screens. */
export function useRawConfig() {
  const [data, setData] = useState<QshConfigYaml | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await fetch(apiUrl('api/config/raw'))
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      setData(json)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { data, error, loading, refetch }
}

/** Patch a single config section. */
export function usePatchConfig() {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = useCallback(
    async <T>(
      section: string,
      data: T
    ): Promise<{ updated: string; restart_required: boolean; message: string } | null> => {
      setSaving(true)
      setError(null)
      try {
        const resp = await fetch(apiUrl(`api/config/${section}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data }),
        })
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
          throw new Error(err.detail || `HTTP ${resp.status}`)
        }
        return resp.json()
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Unknown error')
        return null
      } finally {
        setSaving(false)
      }
    },
    []
  )

  return { patch, saving, error }
}

/** Delete an optional config section. */
export async function deleteSection(
  section: string
): Promise<{ deleted: string; was_present: boolean; restart_required?: boolean } | null> {
  try {
    const resp = await fetch(apiUrl(`api/config/${section}`), {
      method: 'DELETE',
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
      throw new Error(err.detail || `HTTP ${resp.status}`)
    }
    return resp.json()
  } catch {
    return null
  }
}

/** Patch a section, or delete it if toggle is off. Returns a promise. */
export function patchOrDelete<T extends object>(
  section: string,
  enabled: boolean,
  data: T
): Promise<unknown> {
  if (!enabled) {
    return deleteSection(section).then((r) => {
      if (!r) throw new Error(`Failed to delete ${section}`)
      return r
    })
  }
  return fetch(apiUrl(`api/config/${section}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  }).then((resp) => {
    if (!resp.ok) throw new Error(`Failed to save ${section}`)
    return resp.json()
  })
}
