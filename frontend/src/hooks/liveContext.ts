import { createContext, useContext } from 'react'
import type { CycleMessage } from '../types/api'

export interface UseLiveResult {
  data: CycleMessage | null
  isConnected: boolean
  lastUpdate: number
  disconnectedSince: number | null
}

export const LiveContext = createContext<UseLiveResult | null>(null)

export function useLiveContext(): UseLiveResult {
  const ctx = useContext(LiveContext)
  if (ctx === null) {
    throw new Error(
      'useLive() must be called inside a <LiveProvider>. Wrap your component tree ' +
      'in <LiveProvider> at the top of the application (currently main.tsx).',
    )
  }
  return ctx
}
