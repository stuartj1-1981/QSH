import {
  useLiveData,
  useLiveConnection,
  type LiveDataValue,
  type LiveConnectionValue,
} from './liveContext'

export interface UseLiveResult {
  data: LiveDataValue['data']
  isConnected: LiveConnectionValue['isConnected']
  lastUpdate: LiveDataValue['lastUpdate']
  disconnectedSince: LiveConnectionValue['disconnectedSince']
}

/**
 * @deprecated Prefer useLiveData() or useLiveConnection() for targeted
 * subscriptions. This shim subscribes to both contexts and re-renders
 * whenever either changes — the same behaviour as pre-INSTRUCTION-250.
 * Retained for compatibility with call sites that have not been migrated.
 */
export function useLive(): UseLiveResult {
  const { data, lastUpdate } = useLiveData()
  const { isConnected, disconnectedSince } = useLiveConnection()
  return { data, isConnected, lastUpdate, disconnectedSince }
}

export { useLiveData, useLiveConnection } from './liveContext'
