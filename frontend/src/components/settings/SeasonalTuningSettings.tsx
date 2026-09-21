// Driver-agnostic: this component exposes no HA entity IDs or MQTT topics. Audited INSTRUCTION-88D.
import { useState, useEffect, useRef } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '../../lib/utils'
import { apiUrl } from '../../lib/api'
import { useStatus } from '../../hooks/useStatus'
import { ControlValueDisplay } from './ControlValueDisplay'
import type { Driver, HeatSourceYaml } from '../../types/config'
import type { ControlSource } from '../../types/api'

interface SeasonalTuningSettingsProps {
  antifrostThreshold: number | null
  shoulderThreshold: number | null
  driver: Driver
  onRefetch: () => void
  // INSTRUCTION-544B T10(e) — the processed-config refetch, distinct from
  // onRefetch (raw config, shared verbatim with every sibling settings
  // component — do not widen what that one does).
  onRefetchProcessed: () => void
  // T10(b) — D1 answered from the tree (P29): Settings.tsx already holds
  // this array and already passes it to two sibling components. Optional so
  // pre-existing callers still type-check.
  heatSources?: HeatSourceYaml[]
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
  onChange: (value: number) => void | Promise<void>
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
      // INSTRUCTION-544B T10(f) — onChange is now async (it reads resp.ok);
      // await it so a rejection is actually caught here rather than becoming
      // an unhandled promise rejection that never flashes the error.
      void (async () => {
        try {
          await onChange(clamped)
        } catch {
          setLocalValue(prev)
          setHasError(true)
          if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
          errorTimerRef.current = setTimeout(() => setHasError(false), 1500)
        }
      })()
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
  onRefetchProcessed,
  heatSources,
}: SeasonalTuningSettingsProps) {
  // INSTRUCTION-544B T10(c) — the ControlSource row is read inside the
  // component from statusData?.control_sources, as HeatSourceSettings.tsx
  // does at :143 and :1087 (P31).
  const { data: statusData } = useStatus()
  const controlSources = statusData?.control_sources
  const antifrostSource = controlSources?.find((cs) => cs.key === 'antifrost_oat_threshold_internal')
  const shoulderSource = controlSources?.find((cs) => cs.key === 'hp_min_output_kw_internal')
  const antifrostExternal = !!antifrostSource?.external_id
  const singleSource = (heatSources?.length ?? 1) <= 1
  const shoulderExternal = !!shoulderSource?.external_id

  // Antifrost has one shape (an entity, or not) — no SSC override exists for
  // it, unlike shoulder (§1.3), so singleSource plays no part in its gate.
  const antifrostReadOnly = antifrostExternal
  // Shoulder has two shapes and the second is not an entity (§1.3):
  // INSTRUCTION-330's source-selection controller re-stamps
  // hp_min_output_kw every cycle on a multi-source install, so an editable
  // stepper there is the trap this family exists to close (T10(c)).
  const shoulderReadOnly = !singleSource || shoulderExternal

  // OB-09 requires shoulder to render read-only AND name the active source
  // on a multi-source install even with no entity bound — a shape
  // ControlValueDisplay's own three-state logic (entity-only) has no branch
  // for. A synthetic external-shaped row forces its "external connected"
  // branch, naming the active heat source rather than an entity id.
  const shoulderDisplaySource: ControlSource | undefined =
    !shoulderReadOnly || shoulderExternal || !shoulderSource
      ? shoulderSource
      : {
          ...shoulderSource,
          source: 'external',
          external_id: statusData?.source_selection?.active_source || 'multiple heat sources',
          external_raw: shoulderThreshold != null ? String(shoulderThreshold) : '',
        }

  const handleAntifrostChange = async (value: number) => {
    const resp = await fetch(apiUrl('api/control/antifrost-threshold'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    onRefetch()
    onRefetchProcessed()
    // INSTRUCTION-544B T10(f) — antifrost already writes through its control
    // route (P40), so after 544A this is a reader for its 5xx nothing read
    // before.
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`)
    }
  }

  const handleShoulderChange = async (value: number) => {
    const resp = await fetch(apiUrl('api/control/shoulder-threshold'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    onRefetch()
    onRefetchProcessed()
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-[var(--text)]">Seasonal Tuning</h2>

      <div className="space-y-6 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        {antifrostReadOnly ? (
          <ControlValueDisplay
            label="Antifrost OAT Threshold (Shoulder Mode Disable)"
            controlSource={antifrostSource}
            internalValue={antifrostThreshold ?? 0}
            onInternalChange={() => {}}
            unit="°C"
            min={0}
            max={15}
            step={0.5}
          />
        ) : (
          <Stepper
            label="Antifrost OAT Threshold (Shoulder Mode Disable)"
            helpText="Below this outdoor temperature, QSH maintains continuous HP operation to prevent manufacturer antifrost from seizing control."
            value={antifrostThreshold}
            unit="°C"
            min={0}
            max={15}
            step={0.5}
            onChange={handleAntifrostChange}
          />
        )}

        {shoulderReadOnly ? (
          <ControlValueDisplay
            label="Shoulder Shutdown Threshold"
            controlSource={shoulderDisplaySource}
            internalValue={shoulderThreshold ?? 0}
            onInternalChange={() => {}}
            unit="kW"
            min={0.5}
            max={10}
            step={0.5}
          />
        ) : (
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
        )}
      </div>
    </div>
  )
}
