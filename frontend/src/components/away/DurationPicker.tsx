import { cn } from '../../lib/utils'

const PRESETS = [
  { label: 'Tonight', days: 0.5 },
  { label: 'Tomorrow', days: 1 },
  { label: '2 days', days: 2 },
  { label: '1 week', days: 7 },
]

interface DurationPickerProps {
  days: number
  onChange: (days: number) => void
}

export function DurationPicker({ days, onChange }: DurationPickerProps) {
  return (
    <div>
      <p className="text-sm text-[var(--text-muted)] mb-2">Back in...</p>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.days}
            onClick={() => onChange(p.days)}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium border transition-colors',
              days === p.days
                ? 'bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--accent)]'
                : 'bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]'
            )}
          >
            {p.label}
          </button>
        ))}
        <input
          type="number"
          min={0}
          step={0.5}
          value={days}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-20 px-3 py-2 rounded-full bg-[var(--bg)] border border-[var(--border)] text-sm text-center"
          title="Custom days"
        />
      </div>
    </div>
  )
}
