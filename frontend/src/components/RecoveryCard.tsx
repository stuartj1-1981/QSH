import { memo } from 'react'
import { Clock, CheckCircle2 } from 'lucide-react'

interface RecoveryCardProps {
  recoveryTimeHours: number
  capacityPct: number
  operatingState?: string
}

function formatRecoveryTime(hours: number): string {
  if (hours < 0) return 'Insufficient capacity'
  if (hours <= 0.05) return 'At comfort'
  if (hours >= 24) return '24h+'
  if (hours < 1) return `${Math.round(hours * 60)} min`
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

const HP_OFF_STATES = ['Shoulder (Monitoring)', 'Summer']

function capacityColor(pct: number): string {
  if (pct > 100) return 'var(--red)'
  if (pct >= 80) return 'var(--amber)'
  return 'var(--green)'
}

export const RecoveryCard = memo(function RecoveryCard({ recoveryTimeHours, capacityPct, operatingState }: RecoveryCardProps) {
  const isHpOff = HP_OFF_STATES.includes(operatingState ?? '')
  const atComfort = !isHpOff && recoveryTimeHours >= 0 && recoveryTimeHours <= 0.05
  const color = capacityColor(capacityPct)

  let display: string
  if (isHpOff) {
    display = recoveryTimeHours < 0 ? '\u2014' : formatRecoveryTime(recoveryTimeHours)
  } else {
    display = formatRecoveryTime(recoveryTimeHours)
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
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
