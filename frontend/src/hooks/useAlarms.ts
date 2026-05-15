import { useMemo } from 'react'
import { useLive } from './useLive'
import { useHistorianQuery } from './useHistorian'
import type { AlarmEvent } from '../types/api'

interface UseAlarmsResult {
  liveAlarms: AlarmEvent[]
  historicalAlarms: AlarmEvent[]
  loading: boolean
  error: string | null
}

export function useAlarms(timeFrom: string = '-7d'): UseAlarmsResult {
  const { data: cycle } = useLive()
  const liveAlarms = useMemo<AlarmEvent[]>(
    () => (cycle?.active_alarms ?? []) as AlarmEvent[],
    [cycle?.active_alarms],
  )

  const { data: historianData, loading, error } = useHistorianQuery(
    'qsh_alarm_event',
    ['payload_json'],
    { timeFrom, timeTo: 'now()', interval: '5m', aggregation: 'last' },
  )

  const historicalAlarms = useMemo<AlarmEvent[]>(() => {
    if (!historianData?.points) return []
    return historianData.points
      .map((p): AlarmEvent | null => {
        const point = p as unknown as Record<string, unknown>
        const payloadJsonRaw = point['payload_json']
        let payload: Record<string, unknown> = {}
        if (typeof payloadJsonRaw === 'string') {
          try {
            payload = JSON.parse(payloadJsonRaw) as Record<string, unknown>
          } catch {
            payload = {}
          }
        }
        const alarmId = point['alarm_id']
        if (alarmId !== 'A' && alarmId !== 'B') return null
        const ts = point['timestamp']
        const room = point['room']
        return {
          alarm_id: alarmId as 'A' | 'B',
          timestamp: typeof ts === 'number' ? ts : 0,
          room: typeof room === 'string' ? room : null,
          payload,
          severity: 'notification',
        }
      })
      .filter((ev): ev is AlarmEvent => ev !== null)
  }, [historianData])

  return { liveAlarms, historicalAlarms, loading, error }
}
