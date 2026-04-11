import { cn } from '../../lib/utils'

interface AwayToggleProps {
  active: boolean
  onToggle: (active: boolean) => void
  loading?: boolean
}

export function AwayToggle({ active, onToggle, loading }: AwayToggleProps) {
  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 text-center">
      <h2 className="text-lg font-semibold mb-4">Away Mode</h2>
      <button
        onClick={() => onToggle(!active)}
        disabled={loading}
        className={cn(
          'w-20 h-10 rounded-full relative transition-colors',
          active ? 'bg-[var(--accent)]' : 'bg-gray-400'
        )}
      >
        <div
          className={cn(
            'absolute top-1 w-8 h-8 rounded-full bg-white shadow transition-transform',
            active ? 'translate-x-11' : 'translate-x-1'
          )}
        />
      </button>
      <p className="text-sm text-[var(--text-muted)] mt-2">
        {loading
          ? 'Updating...'
          : active ? 'Away mode is active' : 'You are home'}
      </p>
    </div>
  )
}
