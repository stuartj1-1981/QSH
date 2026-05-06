import { useLiveContext, type UseLiveResult } from './liveContext'

export type { UseLiveResult }

export function useLive(): UseLiveResult {
  return useLiveContext()
}
