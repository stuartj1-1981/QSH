import { memo } from 'react'
import { Clock, CheckCircle2 } from 'lucide-react'
import type { RecoveryState } from '../types/api'

interface RecoveryCardProps {
  recoveryState: RecoveryState
  recoveryTimeHours: number
  capacityPct: number
}

// The text for every state except `recovering`, which shows the time.
const STATE_TEXT: Record<Exclude<RecoveryState, 'recovering'>, string> = {
  no_demand: 'No Demand',
  below_minimum: 'Demand below minimum',
  insufficient_capacity: 'Insufficient capacity',
  at_comfort: 'At comfort',
  waiting: '\u2014',
}

function formatRecoveryTime(hours: number): string {
  if (hours >= 24) return '24h+'
  if (hours < 1) return `${Math.round(hours * 60)} min`
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function capacityColor(pct: number): string {
  if (pct > 100) return 'var(--red)'
  if (pct >= 80) return 'var(--amber)'
  return 'var(--green)'
}

export const RecoveryCard = memo(function RecoveryCard({ recoveryState, recoveryTimeHours, capacityPct }: RecoveryCardProps) {
  const atComfort = recoveryState === 'at_comfort'
  const color = capacityColor(capacityPct)
  // A state that the table lacks (a newer backend) shows the dash.
  const display = recoveryState === 'recovering' ? formatRecoveryTime(recoveryTimeHours) : (STATE_TEXT[recoveryState] ?? STATE_TEXT.waiting)

  return (
    <div data-testid="recovery-card" className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
      <div className="flex items-center gap-2 mb-1">
        {atComfort ? (
          <CheckCircle2 size={16} style={{ color }} />
        ) : (
          <Clock size={16} style={{ color }} />
        )}
        <span className="text-xs text-[var(--text-muted)]">Time to comfort</span>
      </div>
      <div className="text-lg font-semibold">{display}</div>
    </div>
  )
})
