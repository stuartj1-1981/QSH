import { useEffect, useState } from 'react'
import type { CycleMessage } from '../types/api'
import { wsUrl } from '../lib/api'

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
        try {
          const msg: CycleMessage = JSON.parse(event.data)
          if (msg.type === 'cycle') {
            setData(msg)
            setLastUpdate(Date.now())
          }
        } catch {
          // ignore parse errors
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
