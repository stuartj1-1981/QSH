import { HelpTip } from '../HelpTip'

interface TopicFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  helpText?: string
  lastPayload?: string
  lastSeenAt?: string
  onDiscover?: () => void
  disabled?: boolean
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function TopicField({
  label,
  value,
  onChange,
  placeholder = 'temps/outsideTemp',
  helpText,
  lastPayload,
  lastSeenAt,
  onDiscover,
  disabled,
}: TopicFieldProps) {
  return (
    <div>
      <label className={`text-xs text-[var(--text-muted)] mb-1 ${helpText ? 'flex items-center gap-1' : 'block'}`}>
        {label}
        {helpText && <HelpTip text={helpText} size={12} />}
      </label>
      <div className="flex gap-1">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value || '')}
          placeholder={placeholder}
          maxLength={256}
          disabled={disabled}
          className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]"
        />
        {onDiscover && (
          <button
            type="button"
            onClick={onDiscover}
            disabled={disabled}
            className="shrink-0 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            Discover
          </button>
        )}
      </div>
      {lastPayload !== undefined && (
        <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
          Last: {lastPayload}{lastSeenAt ? ` (${relativeTime(lastSeenAt)})` : ''}
        </p>
      )}
    </div>
  )
}
