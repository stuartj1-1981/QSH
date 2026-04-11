import { useState, useEffect, useRef, memo } from 'react'
import { Minus, Plus, Droplets } from 'lucide-react'
import { cn } from '../lib/utils'
import { EntityValue } from './EntityValue'

interface FlowLimitsProps {
  flowMin: number | null
  flowMax: number | null
  onFlowMinChange: (value: number) => void
  onFlowMaxChange: (value: number) => void
  entityIds?: {
    flow_min?: string
    flow_max?: string
  }
  engineering?: boolean
}

export const FlowLimits = memo(function FlowLimits({
  flowMin,
  flowMax,
  onFlowMinChange,
  onFlowMaxChange,
  entityIds,
  engineering,
}: FlowLimitsProps) {
  const [localMin, setLocalMin] = useState<number | null>(flowMin)
  const [localMax, setLocalMax] = useState<number | null>(flowMax)
  const [errorField, setErrorField] = useState<'min' | 'max' | null>(null)
  const debounceMinRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const debounceMaxRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Sync from server values
  useEffect(() => { setLocalMin(flowMin) }, [flowMin])
  useEffect(() => { setLocalMax(flowMax) }, [flowMax])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceMinRef.current) clearTimeout(debounceMinRef.current)
      if (debounceMaxRef.current) clearTimeout(debounceMaxRef.current)
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    }
  }, [])

  const flashError = (field: 'min' | 'max', revertValue: number | null) => {
    if (field === 'min') setLocalMin(revertValue)
    else setLocalMax(revertValue)
    setErrorField(field)
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => setErrorField(null), 1500)
  }

  const adjustMin = (delta: number) => {
    if (localMin === null) return
    const newVal = Math.round((localMin + delta) * 2) / 2
    const clamped = Math.max(20, Math.min(45, newVal))
    // Cross-validation: min must stay below max
    if (localMax !== null && clamped >= localMax) return
    const prev = localMin
    setLocalMin(clamped)

    if (debounceMinRef.current) clearTimeout(debounceMinRef.current)
    debounceMinRef.current = setTimeout(() => {
      try {
        onFlowMinChange(clamped)
      } catch {
        flashError('min', prev)
      }
    }, 500)
  }

  const adjustMax = (delta: number) => {
    if (localMax === null) return
    const newVal = Math.round((localMax + delta) * 2) / 2
    const clamped = Math.max(30, Math.min(60, newVal))
    // Cross-validation: max must stay above min
    if (localMin !== null && clamped <= localMin) return
    const prev = localMax
    setLocalMax(clamped)

    if (debounceMaxRef.current) clearTimeout(debounceMaxRef.current)
    debounceMaxRef.current = setTimeout(() => {
      try {
        onFlowMaxChange(clamped)
      } catch {
        flashError('max', prev)
      }
    }, 500)
  }

  const nullState = flowMin === null && flowMax === null

  return (
    <div className={cn(
      'rounded-xl border p-4 mb-4',
      'bg-[var(--bg-card)] border-[var(--border)]'
    )}>
      <div className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] mb-3">
        <Droplets size={16} className="text-[var(--accent)]" />
        <span>Flow Limits</span>
      </div>

      <div className="flex items-center gap-6 flex-wrap">
        {/* Min */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)] w-8">Min</span>
          <button
            onClick={() => adjustMin(-0.5)}
            disabled={nullState || (localMin !== null && localMin <= 20) || (localMin !== null && localMax !== null && localMin - 0.5 < 20)}
            className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border border-[var(--border)] hover:bg-[var(--bg)] disabled:opacity-40"
          >
            <Minus size={14} />
          </button>
          <EntityValue entityId={entityIds?.flow_min} engineering={engineering}>
            <span className={cn(
              'text-xl font-bold w-16 text-center transition-colors',
              errorField === 'min' && 'text-red-500'
            )}>
              {localMin !== null ? `${localMin.toFixed(1)}°` : '--'}
            </span>
          </EntityValue>
          <button
            onClick={() => adjustMin(0.5)}
            disabled={nullState || (localMin !== null && localMin >= 45) || (localMin !== null && localMax !== null && localMin + 0.5 >= localMax)}
            className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border border-[var(--border)] hover:bg-[var(--bg)] disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Max */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)] w-8">Max</span>
          <button
            onClick={() => adjustMax(-0.5)}
            disabled={nullState || (localMax !== null && localMax <= 30) || (localMin !== null && localMax !== null && localMax - 0.5 <= localMin)}
            className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border border-[var(--border)] hover:bg-[var(--bg)] disabled:opacity-40"
          >
            <Minus size={14} />
          </button>
          <EntityValue entityId={entityIds?.flow_max} engineering={engineering}>
            <span className={cn(
              'text-xl font-bold w-16 text-center transition-colors',
              errorField === 'max' && 'text-red-500'
            )}>
              {localMax !== null ? `${localMax.toFixed(1)}°` : '--'}
            </span>
          </EntityValue>
          <button
            onClick={() => adjustMax(0.5)}
            disabled={nullState || (localMax !== null && localMax >= 60)}
            className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border border-[var(--border)] hover:bg-[var(--bg)] disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
  )
})
