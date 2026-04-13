// Driver-agnostic: this component exposes no HA entity IDs or MQTT topics. Audited INSTRUCTION-88D.
import { useState, useEffect, useRef } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '../../lib/utils'
import { apiUrl } from '../../lib/api'
import type { Driver } from '../../types/config'

interface SeasonalTuningSettingsProps {
  antifrostThreshold: number | null
  shoulderThreshold: number | null
  driver: Driver
  onRefetch: () => void
}

function Stepper({
  label,
  helpText,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  helpText: string
  value: number | null
  unit: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const [localValue, setLocalValue] = useState<number | null>(value)
  const [hasError, setHasError] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => { setLocalValue(value) }, [value])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    }
  }, [])

  const adjust = (delta: number) => {
    if (localValue === null) return
    const newVal = Math.round((localValue + delta) * 10) / 10
    const clamped = Math.max(min, Math.min(max, newVal))
    const prev = localValue
    setLocalValue(clamped)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      try {
        onChange(clamped)
      } catch {
        setLocalValue(prev)
        setHasError(true)
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
        errorTimerRef.current = setTimeout(() => setHasError(false), 1500)
      }
    }, 500)
  }

  const disabled = value === null

  return (
    <div>
      <label className="block text-xs font-medium text-[var(--text)] mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2 mb-1">
        <button
          onClick={() => adjust(-step)}
          disabled={disabled || (localValue !== null && localValue <= min)}
          className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border border-[var(--border)] hover:bg-[var(--bg)] disabled:opacity-40"
        >
          <Minus size={14} />
        </button>
        <span className={cn(
          'text-lg font-bold w-20 text-center transition-colors',
          hasError && 'text-red-500'
        )}>
          {localValue !== null ? `${localValue.toFixed(1)} ${unit}` : '--'}
        </span>
        <button
          onClick={() => adjust(step)}
          disabled={disabled || (localValue !== null && localValue >= max)}
          className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border border-[var(--border)] hover:bg-[var(--bg)] disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </div>
      <p className="text-xs text-[var(--text-muted)]">{helpText}</p>
    </div>
  )
}

// driver threaded in 88B; consumed in 88C/88D via rename to `driver`
export function SeasonalTuningSettings({
  antifrostThreshold,
  shoulderThreshold,
  driver: _driver,
  onRefetch,
}: SeasonalTuningSettingsProps) {
  const handleAntifrostChange = async (value: number) => {
    await fetch(apiUrl('api/control/antifrost-threshold'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    onRefetch()
  }

  const handleShoulderChange = async (value: number) => {
    await fetch(apiUrl('api/control/shoulder-threshold'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    onRefetch()
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-[var(--text)]">Seasonal Tuning</h2>

      <div className="space-y-6 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <Stepper
          label="Antifrost OAT Threshold"
          helpText="Below this outdoor temperature, QSH maintains continuous HP operation to prevent manufacturer antifrost from seizing control."
          value={antifrostThreshold}
          unit="°C"
          min={0}
          max={15}
          step={0.5}
          onChange={handleAntifrostChange}
        />

        <Stepper
          label="Shoulder Shutdown Threshold"
          helpText="When total demand drops below this threshold, QSH shuts down the HP in shoulder season."
          value={shoulderThreshold}
          unit="kW"
          min={0.5}
          max={10}
          step={0.5}
          onChange={handleShoulderChange}
        />
      </div>
    </div>
  )
}
