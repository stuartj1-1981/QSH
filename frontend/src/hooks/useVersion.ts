import { useEffect, useState } from 'react'
import { apiUrl } from '../lib/api'
import type { HealthResponse } from '../types/api'

interface UseVersionResult {
  version: string | null
  loading: boolean
}

/**
 * Fetch the addon version from /api/health exactly once on mount.
 *
 * No polling: the addon version is a build-time constant and cannot change
 * without the backend restarting (which tears down the page regardless).
 */
export function useVersion(): UseVersionResult {
  const [version, setVersion] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    fetch(apiUrl('api/health'), { signal: controller.signal })
      .then((r) => r.json() as Promise<HealthResponse>)
      .then((data) => {
        setVersion(data.addon_version)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
    return () => controller.abort()
  }, [])

  return { version, loading }
}
