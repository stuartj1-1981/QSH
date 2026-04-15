import { memo } from 'react'

interface EngineeringBarProps {
  cycleNumber: number
  detFlow: number
  rlFlow: number | null
  rlBlend: number
  rlReward: number
  shoulderMonitoring: boolean
  summerMonitoring: boolean
  antifrostOverrideActive: boolean
  winterEquilibrium: boolean
}

export const EngineeringBar = memo(function EngineeringBar({
  cycleNumber,
  detFlow,
  rlFlow,
  rlBlend,
  rlReward,
  shoulderMonitoring,
  summerMonitoring,
  antifrostOverrideActive,
  winterEquilibrium,
}: EngineeringBarProps) {
  return (
    <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3 mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-[var(--accent)]">ENGINEERING</span>
        <span className="text-xs text-[var(--text-muted)]">Cycle #{cycleNumber}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-[11px] sm:text-xs">
        <Stat label="Det" value={`${detFlow.toFixed(1)}°C`} />
        <Stat label="RL" value={rlFlow !== null ? `${rlFlow.toFixed(1)}°C` : 'n/a'} />
        <Stat label="Blend" value={rlBlend.toFixed(3)} />
        <Stat label="Reward" value={rlReward.toFixed(2)} />
        {antifrostOverrideActive && (
          <span className="px-2 py-0.5 rounded-full bg-[var(--blue)]/20 text-[var(--blue)] font-medium">
            {winterEquilibrium ? 'Winter (Eq)' : 'Winter'}
          </span>
        )}
        {shoulderMonitoring && <Badge label="Shoulder" />}
        {summerMonitoring && <Badge label="Summer" />}
      </div>
    </div>
  )
})

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[var(--text-muted)]">{label}: </span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  )
}

function Badge({ label }: { label: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full bg-[var(--amber)]/20 text-[var(--amber)] font-medium">
      {label}
    </span>
  )
}
