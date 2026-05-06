import { useEffect, useState, type ReactNode } from 'react'
import type { CycleMessage } from '../types/api'
import { wsUrl } from '../lib/api'
import { cycleSnapshotSchema } from '../types/schemas'
import { LiveContext, type UseLiveResult } from './liveContext'

function useLiveImpl(): UseLiveResult {
  const [data, setData] = useState<CycleMessage | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(0)
  const [disconnectedSince, setDisconnectedSince] = useState<number | null>(null)

  useEffect(() => {
    let retryCount = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let ws: WebSocket | null = null

    function connect() {
      ws = new WebSocket(wsUrl('ws/live'))

      ws.onopen = () => {
        setIsConnected(true)
        setDisconnectedSince(null)
        retryCount = 0
      }

      ws.onmessage = (event) => {
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
        setDisconnectedSince((prev) => prev ?? Date.now())
        ws = null
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

  return { data, isConnected, lastUpdate, disconnectedSince }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const value = useLiveImpl()
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}
