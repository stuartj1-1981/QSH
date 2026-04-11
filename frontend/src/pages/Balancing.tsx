import { useBalancing } from '../hooks/useBalancing'
import { cn } from '../lib/utils'
import { HelpTip } from '../components/HelpTip'
import { BALANCING } from '../lib/helpText'
import type { BalancingRoom } from '../types/api'

function turnSuggestion(room: BalancingRoom): string | null {
  if (room.control_mode === 'direct') return null
  const absRatio = Math.abs(room.imbalance_ratio)
  if (absRatio < 0.25) return null
  const direction = room.imbalance_ratio > 0 ? 'closing' : 'opening'
  let turns: string
  if (absRatio < 0.35) turns = '1/4 turn'
  else if (absRatio < 0.60) turns = '1/2 turn'
  else turns = '3/4 turn'
  return `Try ${direction} the lockshield valve by ${turns}.`
}

function statusBadge(status: BalancingRoom['balance_status']) {
  const map: Record<string, { label: string; cls: string }> = {
    automatic: { label: 'Automatic', cls: 'bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:text-blue-100' },
    balanced: { label: 'Balanced', cls: 'bg-green-100 text-green-900 dark:bg-green-900/50 dark:text-green-100' },
    monitoring: { label: 'In Monitoring', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100' },
  }
  const info = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100' }
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', info.cls)}>
      {info.label}
    </span>
  )
}

export function Balancing() {
  const { data, error, loading, setNotificationDisabled } = useBalancing()

  if (loading) {
    return <p className="text-[var(--text-muted)] p-4">Loading balancing data...</p>
  }

  if (error) {
    return <p className="text-red-500 p-4">Error: {error}</p>
  }

  if (!data || data.error) {
    return (
      <p className="text-[var(--text-muted)] p-4">
        {data?.error ?? 'Balancing data unavailable.'}
      </p>
    )
  }

  const rooms = Object.entries(data.rooms)
  const pendingRecs = rooms.filter(([, r]) => r.recommendation_pending)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)]">Balancing</h2>
        <p className="text-sm text-[var(--text-muted)]">Per-zone hydraulic balance status</p>
      </div>

      {/* Summary bar */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
          <span className="text-[var(--text-muted)]">Zones:</span>{' '}
          <span className="font-medium text-[var(--text)]">{rooms.length}</span>
        </div>
        <div className="px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
          <span className="text-[var(--text-muted)]">Imbalanced:</span>{' '}
          <span className="font-medium text-[var(--text)]">{data.imbalanced_count}</span>
        </div>
        <div className="px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
          <span className="text-[var(--text-muted)]">Observations:</span>{' '}
          <span className="font-medium text-[var(--text)]">{data.total_observations}</span>
        </div>
      </div>

      {/* Zone table */}
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--bg-card)] text-[var(--text-muted)] text-left">
              <th className="px-2 sm:px-4 py-3 font-medium">Zone</th>
              <th className="px-2 sm:px-4 py-3 font-medium">Status</th>
              <th className="px-2 sm:px-4 py-3 font-medium text-right"><span className="flex items-center justify-end gap-1">Deviation <HelpTip text={BALANCING.severity} size={12} /></span></th>
              <th className="px-2 sm:px-4 py-3 font-medium hidden sm:table-cell"><span className="flex items-center gap-1">Suggestion <HelpTip text={BALANCING.suggestion} size={12} /></span></th>
              <th className="px-2 sm:px-4 py-3 font-medium text-right hidden md:table-cell">Data</th>
              <th className="px-2 sm:px-4 py-3 font-medium text-center hidden sm:table-cell">Notify</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rooms.map(([name, room]) => (
              <tr key={name} className="bg-[var(--bg)]">
                <td className="px-2 sm:px-4 py-3">
                  <div className="font-medium text-[var(--text)]">
                    {name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">{room.control_mode}</div>
                  {/* Mobile-only suggestion text */}
                  {turnSuggestion(room) && (
                    <div className="text-xs text-amber-600 dark:text-amber-300 mt-1 sm:hidden">
                      {turnSuggestion(room)}
                    </div>
                  )}
                </td>
                <td className="px-2 sm:px-4 py-3">{statusBadge(room.balance_status)}</td>
                <td className="px-2 sm:px-4 py-3 text-right">
                  <span
                    className={cn(
                      'font-mono',
                      Math.abs(room.imbalance_ratio) > 0.25
                        ? 'text-red-500'
                        : 'text-[var(--text)]',
                    )}
                  >
                    {room.imbalance_ratio >= 0 ? '+' : ''}
                    {(room.imbalance_ratio * 100).toFixed(0)}%
                  </span>
                </td>
                <td className="px-2 sm:px-4 py-3 text-sm hidden sm:table-cell">
                  {room.control_mode === 'direct' ? (
                    <span className="text-[var(--text-muted)]">—</span>
                  ) : room.recommendation_pending && room.recommendation_text ? (
                    <span className="text-amber-600 dark:text-amber-400">{room.recommendation_text}</span>
                  ) : turnSuggestion(room) ? (
                    <span className="text-[var(--text)]">{turnSuggestion(room)}</span>
                  ) : (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                </td>
                <td className="px-2 sm:px-4 py-3 text-right text-[var(--text-muted)] hidden md:table-cell">
                  {room.observations} obs
                </td>
                <td className="px-2 sm:px-4 py-3 text-center hidden sm:table-cell">
                  {room.control_mode !== 'direct' ? (
                    <button
                      onClick={() =>
                        setNotificationDisabled(name, !room.notification_disabled)
                      }
                      className={cn(
                        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                        room.notification_disabled
                          ? 'bg-gray-300 dark:bg-gray-600'
                          : 'bg-[var(--accent)]',
                      )}
                      title={
                        room.notification_disabled
                          ? 'Notifications disabled'
                          : 'Notifications enabled'
                      }
                    >
                      <span
                        className={cn(
                          'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                          room.notification_disabled ? 'translate-x-1' : 'translate-x-[18px]',
                        )}
                      />
                    </button>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">auto</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pending recommendations */}
      {pendingRecs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-[var(--text)]">
            Pending Recommendations
          </h3>
          {pendingRecs.map(([name, room]) => (
            <div
              key={name}
              className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-[var(--text)]"
            >
              {room.recommendation_text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
