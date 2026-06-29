import { useDeviceHealth } from '../hooks/useDeviceHealth'
import { cn } from '../lib/utils'
import type { DeviceHealth } from '../types/api'

// Status badge colour is driven by the API `status` value (pinned to the
// latched SENSOR.battery_low state) — NOT recomputed client-side.
function statusBadge(status: DeviceHealth['status']) {
  const map: Record<string, { label: string; cls: string }> = {
    ok: { label: 'OK', cls: 'bg-green-100 text-green-900 dark:bg-green-900/50 dark:text-green-100' },
    low: { label: 'Low', cls: 'bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-100' },
  }
  const info = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100' }
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', info.cls)}>
      {info.label}
    </span>
  )
}

function prettyName(id: string): string {
  return id.replace(/^[a-z_]+\./, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function DeviceHealth() {
  const { data, error, loading } = useDeviceHealth()

  if (loading) {
    return <p className="text-[var(--text-muted)] p-4">Loading device health...</p>
  }

  if (error) {
    return <p className="text-red-500 p-4">Error: {error}</p>
  }

  const devices = Object.entries(data?.devices ?? {})

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)]">Device Health</h2>
        <p className="text-sm text-[var(--text-muted)]">Per-device battery state of charge</p>
      </div>

      {/* Summary bar */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
          <span className="text-[var(--text-muted)]">Devices:</span>{' '}
          <span className="font-medium text-[var(--text)]">{devices.length}</span>
        </div>
        <div className="px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
          <span className="text-[var(--text-muted)]">Low:</span>{' '}
          <span className="font-medium text-[var(--text)]">{data?.low_count ?? 0}</span>
        </div>
      </div>

      {devices.length === 0 ? (
        <p className="text-[var(--text-muted)] p-4">No battery devices configured.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--bg-card)] text-[var(--text-muted)] text-left">
                <th className="px-2 sm:px-4 py-3 font-medium">Device</th>
                <th className="px-2 sm:px-4 py-3 font-medium">Room</th>
                <th className="px-2 sm:px-4 py-3 font-medium text-right">SoC</th>
                <th className="px-2 sm:px-4 py-3 font-medium">Status</th>
                <th className="px-2 sm:px-4 py-3 font-medium text-right">Weeks remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {devices.map(([id, dev]) => (
                <tr key={id} className="bg-[var(--bg)]">
                  <td className="px-2 sm:px-4 py-3">
                    <div className="font-medium text-[var(--text)]">{prettyName(id)}</div>
                    <div className="text-xs text-[var(--text-muted)] font-mono">{id}</div>
                  </td>
                  <td className="px-2 sm:px-4 py-3 text-[var(--text)]">
                    {dev.room ? prettyName(dev.room) : '—'}
                  </td>
                  <td className="px-2 sm:px-4 py-3 text-right">
                    <span
                      className={cn(
                        'font-mono',
                        dev.status === 'low' ? 'text-red-500' : 'text-[var(--text)]',
                      )}
                    >
                      {dev.soc.toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-3">{statusBadge(dev.status)}</td>
                  <td className="px-2 sm:px-4 py-3 text-right font-mono text-[var(--text-muted)]">
                    {dev.weeks_remaining}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
