import { useMemo } from 'react'
import { useLive } from './useLive'
import { useHistorianEvents } from './useHistorian'
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

  const { data: historianData, loading, error } = useHistorianEvents(
    'qsh_alarm_event',
    { timeFrom },
  )

  const historicalAlarms = useMemo<AlarmEvent[]>(() => {
    if (!historianData?.rows) return []
    return historianData.rows
      .map((row): AlarmEvent | null => {
        const payloadJsonRaw = row['payload_json']
        let payload: Record<string, unknown> = {}
        if (typeof payloadJsonRaw === 'string') {
          try {
            payload = JSON.parse(payloadJsonRaw) as Record<string, unknown>
          } catch {
            payload = {}
          }
        }
        const alarmId = row['alarm_id']
        if (alarmId !== 'A' && alarmId !== 'B') return null
        // The event time is the row's own field; the row time is the write.
        const ts = row['timestamp']
        // Alarm B is installation-wide, and its room tag names no room.
        const room = row['room']
        return {
          alarm_id: alarmId,
          timestamp: typeof ts === 'number' ? ts : 0,
          room: typeof room === 'string' && room !== '_installation' ? room : null,
          payload,
          severity: 'notification',
        }
      })
      .filter((ev): ev is AlarmEvent => ev !== null)
  }, [historianData])

  return { liveAlarms, historicalAlarms, loading, error }
}
