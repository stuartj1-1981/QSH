import { useState, useEffect, useRef, memo } from 'react'
import { apiUrl } from '../lib/api'

interface AntifrostThresholdProps {
  threshold: number
}

export const AntifrostThreshold = memo(function AntifrostThreshold({ threshold }: AntifrostThresholdProps) {
  const [localValue, setLocalValue] = useState(threshold)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setLocalValue(threshold)
  }, [threshold])

  const adjust = (delta: number) => {
    const newVal = Math.round((localValue + delta) * 2) / 2  // Snap to 0.5
    const clamped = Math.max(0, Math.min(15, newVal))
    setLocalValue(clamped)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        await fetch(apiUrl('api/control/antifrost-threshold'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: clamped }),
        })
      } catch {
        // Fail silent — next WS cycle will resync displayed value
      }
    }, 500)
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[var(--text-muted)]">Shoulder disable:</span>
      <button
        onClick={() => adjust(-0.5)}
        className="w-5 h-5 rounded text-xs font-bold bg-[var(--bg)] hover:bg-[var(--border)] flex items-center justify-center"
      >
        −
      </button>
      <span className="font-mono font-medium w-12 text-center">
        {localValue.toFixed(1)}°C
      </span>
      <button
        onClick={() => adjust(0.5)}
        className="w-5 h-5 rounded text-xs font-bold bg-[var(--bg)] hover:bg-[var(--border)] flex items-center justify-center"
      >
        +
      </button>
    </div>
  )
})
