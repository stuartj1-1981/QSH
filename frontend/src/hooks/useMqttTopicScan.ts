import { useState, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { MqttScanResponse } from '../types/config'

/**
 * Lightweight wrapper around POST /api/wizard/scan-mqtt-topics
 * for use outside the wizard context (e.g. settings TopicField discovery).
 */
export function useMqttTopicScan() {
  const [topics, setTopics] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(async (durationSeconds?: number) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(apiUrl('api/wizard/scan-mqtt-topics'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration: durationSeconds }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }
      const data: MqttScanResponse = await resp.json()
      const topicStrings = (data.topics || []).map((t) => t.topic)
      setTopics(topicStrings)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setTopics([])
    } finally {
      setLoading(false)
    }
  }, [])

  return { topics, loading, error, scan }
}
