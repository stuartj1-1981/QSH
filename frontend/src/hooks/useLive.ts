import { useEffect, useState } from 'react'
import type { CycleMessage } from '../types/api'
import { wsUrl } from '../lib/api'
import { cycleSnapshotSchema } from '../types/schemas'

interface UseLiveResult {
  data: CycleMessage | null
  isConnected: boolean
  lastUpdate: number
}

export function useLive(): UseLiveResult {
  const [data, setData] = useState<CycleMessage | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(0)

  useEffect(() => {
    let retryCount = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let ws: WebSocket | null = null

    function connect() {
      ws = new WebSocket(wsUrl('ws/live'))

      ws.onopen = () => {
        setIsConnected(true)
        retryCount = 0
      }

      ws.onmessage = (event) => {
        // INSTRUCTION-150E V3 150E-V2-M3: Zod-based runtime parse. JSON
        // parse failures and schema mismatches keep the last-known-good
        // snapshot rather than propagating malformed data to component
        // consumers. The warning surfaces in the browser console so the
        // diagnosis trail is visible to operators.
        let raw: unknown
        try {
          raw = JSON.parse(event.data)
        } catch {
          console.warn('useLive: WebSocket payload was not valid JSON')
          return
        }
        const parsed = cycleSnapshotSchema.safeParse(raw)
        if (!parsed.success) {
          console.warn(
            'useLive: WebSocket payload failed schema validation',
            parsed.error,
          )
          return
        }
        const msg = parsed.data as CycleMessage
        if (msg.type === 'cycle') {
          setData(msg)
          setLastUpdate(Date.now())
        }
      }

      ws.onclose = () => {
        setIsConnected(false)
        ws = null
        // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000)
        retryCount++
        timer = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        ws?.close()
      }
    }

    connect()
    return () => {
      if (timer) clearTimeout(timer)
      if (ws) ws.close()
    }
  }, [])

  return { data, isConnected, lastUpdate }
}
