import { createContext, useContext } from 'react'
import type { CycleMessage } from '../types/api'

// Changes every cycle (~30s).
export interface LiveDataValue {
  data: CycleMessage | null
  lastUpdate: number
}

// Changes only on connect/disconnect transitions (rare).
export interface LiveConnectionValue {
  isConnected: boolean
  disconnectedSince: number | null
}

export const LiveDataContext = createContext<LiveDataValue | null>(null)
export const LiveConnectionContext = createContext<LiveConnectionValue | null>(null)

export function useLiveData(): LiveDataValue {
  const ctx = useContext(LiveDataContext)
  if (ctx === null) {
    throw new Error(
      'useLiveData() must be called inside a <LiveProvider>. Wrap your component tree ' +
      'in <LiveProvider> at the top of the application (currently main.tsx).',
    )
  }
  return ctx
}

export function useLiveConnection(): LiveConnectionValue {
  const ctx = useContext(LiveConnectionContext)
  if (ctx === null) {
    throw new Error(
      'useLiveConnection() must be called inside a <LiveProvider>. Wrap your component tree ' +
      'in <LiveProvider> at the top of the application (currently main.tsx).',
    )
  }
  return ctx
}
