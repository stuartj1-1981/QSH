import { useState } from 'react'
import { apiUrl } from '../../lib/api'
import { cn, formatInterval } from '../../lib/utils'
import type { QshConfigYaml } from '../../types/config'

type WriteBudgetKey = 'flow_writes_per_hour' | 'mode_writes_per_hour'

interface WriteBudgetFieldProps {
  label: string
  fieldKey: WriteBudgetKey
  apiPath: string
  rootConfig: QshConfigYaml | undefined
  onSuccess: () => void
}

export function WriteBudgetField({
  label,
  fieldKey,
  apiPath,
  rootConfig,
  onSuccess,
}: WriteBudgetFieldProps) {
  const initial = rootConfig?.[fieldKey] ?? 6
  const [value, setValue] = useState<number>(initial)
  const [error, setError] = useState<string | null>(null)
  // React-recommended pattern for syncing local state with a prop that may
  // change externally (post-refetch). Setting state during render is OK
  // when guarded by a previous-value comparison — React bails out fast.
  const [lastInitial, setLastInitial] = useState<number>(initial)
  if (lastInitial !== initial) {
    setLastInitial(initial)
    setValue(initial)
  }

  const isValid = (v: number): boolean =>
    Number.isInteger(v) && v >= 3 && v <= 6

  const clamp = (v: number): number => {
    if (!Number.isFinite(v)) return 6
    return Math.max(3, Math.min(6, Math.round(v)))
  }

  const dispatchUpdate = (next: number) => {
    fetch(apiUrl(apiPath), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: next }),
    })
      .then((res) => {
        if (!res.ok) {
          setError('Rejected by server')
          setValue(initial)
          return
        }
        setError(null)
        onSuccess()
      })
      .catch(() => {
        setError('Save failed, retry')
        setValue(initial)
      })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <label className="text-sm text-[var(--text)] min-w-[10rem]" htmlFor={fieldKey}>
          {label}
        </label>
        <input
          id={fieldKey}
          type="number"
          min={3}
          max={6}
          step={1}
          value={value}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              return
            }
            const v = Number(raw)
            if (Number.isNaN(v)) {
              return
            }
            if (isValid(v)) {
              setError(null)
              setValue(v)
            } else if (Number.isInteger(v)) {
              setError('Must be 3–6')
              setValue(v)
            } else {
              setError('Must be 3–6')
            }
          }}
          onBlur={() => {
            const clamped = clamp(value)
            if (clamped !== value) {
              setValue(clamped)
            }
            if (isValid(clamped)) {
              setError(null)
            }
            if (clamped !== initial) {
              dispatchUpdate(clamped)
            }
          }}
          className={cn(
            'w-20 px-2 py-1 rounded border bg-[var(--bg)] text-sm text-[var(--text)]',
            error ? 'border-red-500' : 'border-[var(--border)]'
          )}
        />
        <span className="text-xs text-[var(--text-muted)]">
          ≈ one update every {formatInterval(3600 / clamp(value))}
        </span>
      </div>
      {error && <span className="text-xs text-red-600 pl-[10.75rem]">{error}</span>}
    </div>
  )
}
