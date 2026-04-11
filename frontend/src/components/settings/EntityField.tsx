import { HelpTip } from '../HelpTip'

interface EntityFieldProps {
  label: string
  value: string
  friendlyName?: string
  state?: string
  unit?: string
  placeholder: string
  onChange: (value: string) => void
  helpText?: string
}

export function EntityField({
  label,
  value,
  friendlyName,
  state,
  unit,
  placeholder,
  onChange,
  helpText,
}: EntityFieldProps) {
  return (
    <div>
      <label className={`text-xs text-[var(--text-muted)] mb-1 ${helpText ? 'flex items-center gap-1' : 'block'}`}>
        {label}
        {helpText && <HelpTip text={helpText} size={12} />}
      </label>
      {friendlyName && value && (
        <div className="flex items-center justify-between mb-1 px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)]">
          <span className="text-xs font-medium text-[var(--text)] truncate">
            {friendlyName}
          </span>
          {state && (
            <span className="text-xs text-[var(--text-muted)] shrink-0 ml-2">
              {state}{unit ? ` ${unit}` : ''}
            </span>
          )}
        </div>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value || '')}
        placeholder={placeholder}
        className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]"
      />
    </div>
  )
}
