import { useState, useCallback } from 'react'
import { apiUrl } from '../lib/api'
import type { MqttTestResponse, MqttScanResponse, MqttTopicCandidate } from '../types/config'

interface MqttBrokerParams {
  broker: string
  port: number
  username?: string
  password?: string
  tls?: boolean
  client_id?: string
  topic_prefix?: string
}

export function useMqttScan() {
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<MqttTestResponse | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanTopics, setScanTopics] = useState<MqttTopicCandidate[]>([])
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

  const doScanTopics = useCallback(async (params: MqttBrokerParams, filterRoom?: string) => {
    setScanLoading(true)
    setScanError(null)
    try {
      const resp = await fetch(apiUrl('api/wizard/scan-mqtt-topics'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, filter_room: filterRoom }),
      })
      const data: MqttScanResponse = await resp.json()
      setScanTopics(data.topics || [])
      return data.topics || []
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setScanError(msg)
      return []
    } finally {
      setScanLoading(false)
    }
  }, [])

  return {
    testConnection,
    testLoading,
    testResult,
    scanTopics: doScanTopics,
    scanResults: scanTopics,
    scanLoading,
    scanError,
  }
}
