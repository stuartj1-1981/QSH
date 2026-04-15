import { useState, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { MqttScanResponse, MqttScanMeta } from '../types/config'

/**
 * Lightweight wrapper around POST /api/wizard/scan-mqtt-topics
 * for use outside the wizard context (e.g. settings TopicField discovery).
 *
 * INSTRUCTION-93B: the request parameter is now `windowSeconds` (mapped to
 * `window_seconds` on the wire) to match the aggregating scanner. The value
 * is forwarded only when the caller supplies it, so the backend's default
 * (30s) applies when unspecified.
 */
export function useMqttTopicScan() {
  const [topics, setTopics] = useState<string[]>([])
  const [scanMeta, setScanMeta] = useState<MqttScanMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(async (windowSeconds?: number) => {
    setLoading(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {}
      if (windowSeconds !== undefined) body.window_seconds = windowSeconds

      const resp = await fetch(apiUrl('api/wizard/scan-mqtt-topics'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }
      const data: MqttScanResponse = await resp.json()
      const topicStrings = (data.topics || []).map((t) => t.topic)
      setTopics(topicStrings)
      setScanMeta(data.scan_meta ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setTopics([])
      setScanMeta(null)
    } finally {
      setLoading(false)
    }
  }, [])

  return { topics, scanMeta, loading, error, scan }
}
