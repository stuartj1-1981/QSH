import type { PassiveRecoveryState } from '../../types/api'
import { cn } from '../../lib/utils'

interface PassiveRecoveryPanelProps {
  recovery: Record<string, PassiveRecoveryState> | undefined
}

function confidenceBadge(c: number): string {
  if (c >= 0.7) return 'bg-green-500'
  if (c >= 0.4) return 'bg-yellow-500'
  return 'bg-red-500'
}

export function PassiveRecoveryPanel({ recovery }: PassiveRecoveryPanelProps) {
  if (!recovery || Object.keys(recovery).length === 0) {
    return (
      <div className="p-4 bg-[var(--bg-card)] rounded-lg text-[var(--text-muted)]">
        No passive-recovery predictions this cycle (sysid maturity gate or master-enable off).
      </div>
    )
  }
  const rows = Object.entries(recovery).sort(([a], [b]) => a.localeCompare(b))
  return (
    <div className="p-4 bg-[var(--bg-card)] rounded-lg">
      <h3 className="font-semibold mb-3">Passive Recovery — per Room</h3>
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[380px] text-sm">
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th className="text-left py-1">Room</th>
              <th className="text-right py-1">Predicted T_indoor</th>
              <th className="text-right py-1">Composite Confidence</th>
              <th className="text-right py-1">Bias Correction</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([room, state]) => (
              <tr key={room} className="border-t border-[var(--border)]">
                <td className="py-1 text-[var(--text)]">{room}</td>
                <td className="py-1 text-right">
                  {/* Sanity envelope for domestic indoor temperature. Permanent
                      defence-in-depth against any future numerical regression at
                      the three rate-function sites (INSTRUCTION-227 V4 §Background
                      and INSTRUCTION-227C). Do NOT remove after 227C lands —
                      this guard stays as a backstop regardless of whether the
                      upstream fix is in place. */}
                  {Number.isFinite(state.predicted_t_indoor) &&
                   state.predicted_t_indoor >= -50 &&
                   state.predicted_t_indoor <= 100
                    ? `${state.predicted_t_indoor.toFixed(1)}°C`
                    : <span className="text-[var(--red)]">invalid</span>}
                </td>
                <td className="py-1 text-right">
                  <span
                    className={cn(
                      'inline-block w-12 h-2 rounded mr-2',
                      confidenceBadge(state.composite_confidence),
                    )}
                  />
                  {state.composite_confidence.toFixed(2)}
                </td>
                <td className="py-1 text-right">{state.bias_correction_c.toFixed(2)}°C</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
