import { Bell } from 'lucide-react'
import type { AlarmEvent } from '../../types/api'

interface AlarmsPanelProps {
  liveAlarms: AlarmEvent[]
  historicalAlarms: AlarmEvent[]
  loading: boolean
  error: string | null
}

export function AlarmsPanel({
  liveAlarms, historicalAlarms, loading, error,
}: AlarmsPanelProps) {
  if (loading) return <div className="p-4 text-[var(--text-muted)]">Loading alarms...</div>
  if (error) return <div className="p-4 text-red-500" role="alert">{error}</div>

  return (
    <div className="p-4 bg-[var(--bg-card)] rounded-lg">
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <Bell size={18} /> Alarms
      </h3>
      <div className="mb-4">
        <div className="text-sm font-medium text-[var(--text-muted)] mb-2">
          Active (live cycle):
        </div>
        {liveAlarms.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)]">No active alarms.</div>
        ) : (
          <ul className="space-y-1">
            {liveAlarms.map((a) => (
              <li
                key={`${a.alarm_id}-${a.timestamp}-${a.room ?? '_global'}`}
                className="flex items-center gap-2 p-2 bg-yellow-500/10 border border-yellow-500/40 rounded"
              >
                <span className="text-xs px-2 py-0.5 bg-yellow-500 text-white rounded">
                  {a.severity}
                </span>
                <span className="font-medium">Alarm {a.alarm_id}</span>
                {a.room && <span className="text-[var(--text-muted)]">— {a.room}</span>}
                <span className="ml-auto text-xs text-[var(--text-muted)]">
                  {new Date(a.timestamp * 1000).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="text-sm font-medium text-[var(--text-muted)] mb-2">
          Historical (last 7d):
        </div>
        {historicalAlarms.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)]">No historical alarms.</div>
        ) : (
          <ul className="space-y-1 text-sm max-h-64 overflow-y-auto">
            {historicalAlarms.map((a) => (
              <li
                key={`${a.alarm_id}-${a.timestamp}-${a.room ?? '_global'}`}
                className="flex items-center gap-2 py-1 border-t border-[var(--border)]"
              >
                <span className="text-xs px-2 py-0.5 bg-yellow-500/40 text-yellow-700 dark:text-yellow-300 rounded">
                  {a.severity}
                </span>
                <span>Alarm {a.alarm_id}</span>
                {a.room && <span className="text-[var(--text-muted)]">— {a.room}</span>}
                <span className="ml-auto text-xs text-[var(--text-muted)]">
                  {new Date(a.timestamp * 1000).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
