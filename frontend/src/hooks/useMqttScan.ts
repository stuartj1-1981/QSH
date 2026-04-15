import { useState, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type {
  MqttTestResponse,
  MqttScanResponse,
  MqttTopicCandidate,
  MqttScanMeta,
} from '../types/config'

interface MqttBrokerParams {
  broker: string
  port: number
  username?: string
  password?: string
  tls?: boolean
  client_id?: string
  topic_prefix?: string
}

/**
 * Optional aggregation parameters forwarded to POST /api/wizard/scan-mqtt-topics
 * (INSTRUCTION-93B). Undefined values are omitted from the request body so the
 * backend applies its own defaults (window_seconds=30, aggregate=true, retained=true).
 * Do NOT hardcode defaults on the frontend — keep the two in sync via backend.
 */
interface MqttScanOptions {
  windowSeconds?: number
  aggregateJsonFields?: boolean
  preferRetained?: boolean
}

export function useMqttScan() {
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<MqttTestResponse | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanTopics, setScanTopics] = useState<MqttTopicCandidate[]>([])
  const [scanMeta, setScanMeta] = useState<MqttScanMeta | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  const testConnection = useCallback(async (params: MqttBrokerParams) => {
    setTestLoading(true)
    setTestResult(null)
    try {
      const resp = await fetch(apiUrl('api/wizard/test-mqtt'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      const data: MqttTestResponse = await resp.json()
      setTestResult(data)
      return data
    } catch (e) {
      const result: MqttTestResponse = {
        success: false,
        message: `Network error: ${e instanceof Error ? e.message : String(e)}`,
      }
      setTestResult(result)
      return result
    } finally {
      setTestLoading(false)
    }
  }, [])

  const doScanTopics = useCallback(
    async (
      params: MqttBrokerParams,
      filterRoom?: string,
      options?: MqttScanOptions,
    ) => {
      setScanLoading(true)
      setScanError(null)
      try {
        const body: Record<string, unknown> = { ...params, filter_room: filterRoom }
        if (options?.windowSeconds !== undefined) body.window_seconds = options.windowSeconds
        if (options?.aggregateJsonFields !== undefined)
          body.aggregate_json_fields = options.aggregateJsonFields
        if (options?.preferRetained !== undefined) body.prefer_retained = options.preferRetained

        const resp = await fetch(apiUrl('api/wizard/scan-mqtt-topics'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data: MqttScanResponse = await resp.json()
        setScanTopics(data.topics || [])
        setScanMeta(data.scan_meta ?? null)
        return data.topics || []
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setScanError(msg)
        setScanMeta(null)
        return []
      } finally {
        setScanLoading(false)
      }
    },
    [],
  )

  return {
    testConnection,
    testLoading,
    testResult,
    scanTopics: doScanTopics,
    scanResults: scanTopics,
    scanMeta,
    scanLoading,
    scanError,
  }
}
