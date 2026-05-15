import { useMemo } from 'react'
import type { ReconciliationPoint } from '../../hooks/useReconciliation'

interface ReconciliationDashboardProps {
  points: ReconciliationPoint[]
  loading: boolean
  error: string | null
  selectedController: string
  onControllerChange: (controller: string) => void
  controllers?: string[]
}

const DEFAULT_CONTROLLERS = [
  'recovery_scheduler', 'shoulder_controller', 'tariff_optimiser',
  'valve_controller', 'flow_controller', 'rl',
]

export function ReconciliationDashboard({
  points, loading, error,
  selectedController, onControllerChange,
  controllers = DEFAULT_CONTROLLERS,
}: ReconciliationDashboardProps) {
  const aggregated = useMemo(() => {
    const buckets = new Map<string, ReconciliationPoint[]>()
    for (const p of points) {
      const key = `${p.room}|${p.weather_class ?? 'none'}`
      const arr = buckets.get(key) ?? []
      arr.push(p)
      buckets.set(key, arr)
    }
    return Array.from(buckets.entries()).map(([key, arr]) => {
      const [room, weather_class] = key.split('|')
      const errors = arr.map((p) => Math.abs(p.error_c)).sort((a, b) => a - b)
      const mean = errors.length === 0
        ? 0
        : errors.reduce((s, e) => s + e, 0) / errors.length
      const p95 = errors[Math.floor(errors.length * 0.95)] ?? 0
      return { room, weather_class, count: arr.length, mean, p95 }
    })
  }, [points])

  return (
    <div className="p-4 bg-[var(--bg-card)] rounded-lg">
      <h3 className="font-semibold mb-3">
        Predicted-vs-Actual Reconciliation (twin-prediction with conditional-residual correction)
      </h3>
      <select
        value={selectedController}
        onChange={(e) => onControllerChange(e.target.value)}
        className="mb-3 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded"
      >
        {controllers.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {loading && <div className="text-[var(--text-muted)]">Loading...</div>}
      {error && <div className="text-red-500" role="alert">{error}</div>}
      {!loading && !error && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th className="text-left py-1">Room</th>
              <th className="text-left py-1">Weather Class</th>
              <th className="text-right py-1">Count</th>
              <th className="text-right py-1">Mean |err|</th>
              <th className="text-right py-1">p95 |err|</th>
            </tr>
          </thead>
          <tbody>
            {aggregated.map((row) => (
              <tr
                key={`${row.room}|${row.weather_class}`}
                className="border-t border-[var(--border)]"
              >
                <td className="py-1">{row.room}</td>
                <td className="py-1">{row.weather_class}</td>
                <td className="py-1 text-right">{row.count}</td>
                <td className="py-1 text-right">{row.mean.toFixed(2)}</td>
                <td className="py-1 text-right">{row.p95.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
