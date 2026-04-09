import { useState, useRef, useCallback, useEffect, memo } from 'react'
import { Zap, Flame, ArrowLeftRight, Leaf, PoundSterling, AlertTriangle } from 'lucide-react'
import { cn } from '../lib/utils'
import type { SourceSelectionState, SourceState } from '../types/api'

interface SourceSelectorProps {
  sourceSelection: SourceSelectionState
  onModeChange: (mode: string) => void
  onPreferenceChange: (preference: number) => void
}

function sourceIcon(type: string) {
  if (type === 'heat_pump') return Zap
  return Flame
}

function efficiencyLabel(src: SourceState): string {
  if (src.type === 'heat_pump') return `COP ${src.efficiency.toFixed(1)}`
  return `Eff ${(src.efficiency * 100).toFixed(0)}%`
}

function statusDot(status: string): string {
  switch (status) {
    case 'active': return 'bg-[var(--green)]'
    case 'standby': return 'bg-[var(--amber)]'
    case 'offline': return 'bg-[var(--red)]'
    default: return 'bg-[var(--text-muted)]'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'active': return 'Active'
    case 'standby': return 'Standby'
    case 'offline': return 'Offline'
    default: return status
  }
}

export const SourceSelector = memo(function SourceSelector({ sourceSelection, onModeChange, onPreferenceChange }: SourceSelectorProps) {
  const [sliderValue, setSliderValue] = useState(Math.round(sourceSelection.preference * 100))
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Clean up any pending debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleSliderChange = useCallback((value: number) => {
    setSliderValue(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onPreferenceChange(value / 100)
    }, 500)
  }, [onPreferenceChange])

  const handleSliderRelease = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    onPreferenceChange(sliderValue / 100)
  }, [sliderValue, onPreferenceChange])

  const isAuto = sourceSelection.mode === 'auto'
  const sources = sourceSelection.sources

  // Find the failed-over source name for the failover banner
  const failoverSourceName = sourceSelection.failover_active
    ? sources.find(s => s.status === 'offline')?.name ?? 'Unknown'
    : ''

  return (
    <div className="mb-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <h3 className="text-sm font-semibold text-[var(--text)] mb-3 flex items-center gap-2">
        <ArrowLeftRight size={16} className="text-[var(--accent)]" />
        Heat Source
      </h3>

      {/* Failover banner */}
      {sourceSelection.failover_active && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-[var(--amber)]">
          <AlertTriangle size={14} />
          Failover active — {failoverSourceName} sensors unavailable
        </div>
      )}

      {/* Mode selector — 3 segments */}
      <div className="flex rounded-lg border border-[var(--border)] overflow-hidden mb-3">
        {sources[0] && (
          <ModeButton
            label={sources[0].name}
            icon={sourceIcon(sources[0].type)}
            active={sourceSelection.mode === sources[0].name}
            onClick={() => onModeChange(sources[0].name)}
          />
        )}
        <ModeButton
          label="Auto"
          icon={ArrowLeftRight}
          active={isAuto}
          onClick={() => onModeChange('auto')}
        />
        {sources[1] && (
          <ModeButton
            label={sources[1].name}
            icon={sourceIcon(sources[1].type)}
            active={sourceSelection.mode === sources[1].name}
            onClick={() => onModeChange(sources[1].name)}
          />
        )}
      </div>

      {/* Preference slider — only in auto mode */}
      {isAuto && (
        <div className="mb-3 px-1">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1">
            <span className="flex items-center gap-1"><Leaf size={12} /> Eco</span>
            <span>{sliderValue}%</span>
            <span className="flex items-center gap-1">Cost <PoundSterling size={12} /></span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={sliderValue}
            onChange={(e) => handleSliderChange(parseInt(e.target.value, 10))}
            onMouseUp={handleSliderRelease}
            onTouchEnd={handleSliderRelease}
            className="w-full accent-[var(--accent)]"
          />
        </div>
      )}

      {/* Source cards */}
      <div className="space-y-2">
        {sources.map((src) => (
          <SourceCard
            key={src.name}
            source={src}
            isActive={src.name === sourceSelection.active_source}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="mt-3 text-xs text-[var(--text-muted)]">
        Switches today: {sourceSelection.switch_count_today}/{sourceSelection.max_switches_per_day}
      </div>
    </div>
  )
})

function ModeButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
        active
          ? 'bg-[var(--accent)]/10 text-[var(--accent)] border-r border-[var(--border)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--bg)] border-r border-[var(--border)]',
        'last:border-r-0'
      )}
    >
      <Icon size={14} />
      <span className="truncate">{label}</span>
    </button>
  )
}

const SOURCE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  heat_pump: Zap,
  gas_boiler: Flame,
  lpg_boiler: Flame,
  oil_boiler: Flame,
}

function SourceCard({ source, isActive }: { source: SourceState; isActive: boolean }) {
  const Icon = SOURCE_ICONS[source.type] ?? Flame
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm',
        isActive
          ? 'border-[var(--accent)] bg-[var(--accent)]/5'
          : 'border-[var(--border)]'
      )}
    >
      <Icon size={16} className={isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('w-2 h-2 rounded-full', statusDot(source.status))} />
          <span className="font-medium text-[var(--text)] truncate">{source.name}</span>
          <span className="text-xs text-[var(--text-muted)]">{statusLabel(source.status)}</span>
        </div>
      </div>
      <div className="text-right text-xs text-[var(--text-muted)] whitespace-nowrap">
        <div>{efficiencyLabel(source)}</div>
        <div>£{source.cost_per_kwh_thermal.toFixed(3)}/kWh</div>
      </div>
    </div>
  )
}
