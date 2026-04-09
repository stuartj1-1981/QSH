import type { ControlSource } from '../../types/api'

interface ControlValueDisplayProps {
  label: string
  controlSource: ControlSource | undefined
  internalValue: number | boolean
  onInternalChange: (value: number | boolean) => void
  unit?: string
  min?: number
  max?: number
  step?: number
}

/**
 * Three-state display for control values that support external override.
 *
 * | State                  | Detection                                     | Display                                        |
 * |------------------------|-----------------------------------------------|------------------------------------------------|
 * | Internal only          | source=internal && external_id=''             | Editable input showing internal value          |
 * | External connected     | source=external && external_raw!=''           | Read-only live value with source badge         |
 * | External unavailable   | source=internal && external_id!=''            | Fallback value with amber warning indicator    |
 */
export function ControlValueDisplay({
  label,
  controlSource,
  internalValue,
  onInternalChange,
  unit,
  min,
  max,
  step = 0.5,
}: ControlValueDisplayProps) {
  const isBoolean = typeof internalValue === 'boolean'

  // Determine display state
  const isExternalConnected =
    controlSource?.source === 'external' && controlSource.external_raw !== ''
  const isExternalUnavailable =
    controlSource?.source === 'internal' && !!controlSource?.external_id
  const isInternalOnly =
    !controlSource || (controlSource.source === 'internal' && !controlSource.external_id)

  if (isExternalConnected && controlSource) {
    // External connected — read-only live value with source badge
    return (
      <div>
        <label className="block text-xs font-medium text-[var(--text)] mb-1">
          {label}
        </label>
        <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)]">
          <span className="text-sm font-medium text-[var(--text)]">
            {isBoolean
              ? String(controlSource.value)
              : `${controlSource.value}${unit ? ` ${unit}` : ''}`}
          </span>
          <span className="ml-auto text-xs text-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 rounded">
            via {controlSource.external_id}
          </span>
        </div>
      </div>
    )
  }

  if (isExternalUnavailable && controlSource) {
    // External configured but unavailable — fallback with amber warning
    return (
      <div>
        <label className="block text-xs font-medium text-[var(--text)] mb-1">
          {label}
        </label>
        <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-amber-400/50 bg-amber-50 dark:bg-amber-900/10">
          <span className="text-sm font-medium text-[var(--text)]">
            {isBoolean
              ? String(internalValue)
              : `${internalValue}${unit ? ` ${unit}` : ''}`}
          </span>
          <span className="text-xs text-amber-600 dark:text-amber-400">(fallback)</span>
          <span className="ml-auto text-xs text-amber-600 dark:text-amber-400">
            {controlSource.external_id} unavailable
          </span>
        </div>
      </div>
    )
  }

  // Internal only — editable input
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--text)] mb-1">
        {label}
      </label>
      {isBoolean ? (
        <button
          type="button"
          onClick={() => onInternalChange(!internalValue)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            internalValue
              ? 'bg-[var(--accent)]'
              : 'bg-[var(--border)]'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              internalValue ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      ) : (
        <input
          type="number"
          value={typeof internalValue === 'number' ? internalValue : ''}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v)) onInternalChange(v)
          }}
          min={min}
          max={max}
          step={step}
          className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
        />
      )}
      {isInternalOnly && (
        <p className="text-xs text-[var(--text-muted)] mt-1">
          No entity configured — using internal value
        </p>
      )}
    </div>
  )
}
