import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CycleMessage } from '../types/api'
import { wsUrl } from '../lib/api'
import { cycleSnapshotSchema } from '../types/schemas'
import {
  LiveDataContext,
  LiveConnectionContext,
  type LiveDataValue,
  type LiveConnectionValue,
} from './liveContext'

interface LiveProviderState {
  dataValue: LiveDataValue
  connectionValue: LiveConnectionValue
}

function useLiveImpl(): LiveProviderState {
  const [data, setData] = useState<CycleMessage | null>(null)
  const [lastUpdate, setLastUpdate] = useState(0)
  const [isConnected, setIsConnected] = useState(false)
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

  // INSTRUCTION-250: split provider values so consumers that read only one
  // slice do not re-render on every cycle. The data slice changes every 30 s;
  // the connection slice changes only on connect/disconnect transitions.
  const dataValue = useMemo<LiveDataValue>(
    () => ({ data, lastUpdate }),
    [data, lastUpdate],
  )
  const connectionValue = useMemo<LiveConnectionValue>(
    () => ({ isConnected, disconnectedSince }),
    [isConnected, disconnectedSince],
  )

  return { dataValue, connectionValue }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { dataValue, connectionValue } = useLiveImpl()
  return (
    <LiveConnectionContext.Provider value={connectionValue}>
      <LiveDataContext.Provider value={dataValue}>
        {children}
      </LiveDataContext.Provider>
    </LiveConnectionContext.Provider>
  )
}
