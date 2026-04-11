import { useState, useEffect, useRef, memo } from 'react'
import { Thermometer, Minus, Plus, AlertTriangle, ShieldCheck } from 'lucide-react'
import { cn } from '../lib/utils'

interface ComfortControlProps {
  comfortTemp: number
  controlEnabled: boolean
  saving: boolean
  awayActive?: boolean
  awayDays?: number
  comfortScheduleActive?: boolean
  comfortTempActive?: number
  onComfortTempChange: (value: number) => void
  onControlModeChange: (enabled: boolean) => void
}

export const ComfortControl = memo(function ComfortControl({
  comfortTemp,
  controlEnabled,
  saving,
  awayActive,
  awayDays,
  comfortScheduleActive,
  comfortTempActive,
  onComfortTempChange,
  onControlModeChange,
}: ComfortControlProps) {
  const [localTemp, setLocalTemp] = useState(comfortTemp)
  const [showModal, setShowModal] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Sync local temp when server value changes (but not during user interaction)
  useEffect(() => {
    setLocalTemp(comfortTemp)
  }, [comfortTemp])

  // Close modal on Escape key
  useEffect(() => {
    if (!showModal) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModal(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [showModal])

  const adjustTemp = (delta: number) => {
    const newTemp = Math.round((localTemp + delta) * 2) / 2 // Snap to 0.5 steps
    const clamped = Math.max(15, Math.min(25, newTemp))
    setLocalTemp(clamped)

    // Debounce API call
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onComfortTempChange(clamped)
    }, 500)
  }

  const handleModeConfirm = () => {
    setShowModal(false)
    onControlModeChange(!controlEnabled)
  }

  // Whether we're about to enable live control
  const enablingLive = !controlEnabled

  return (
    <>
      <div className={cn(
        'rounded-xl border p-4 mb-4',
        'bg-[var(--bg-card)] border-[var(--border)]'
      )}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          {/* Comfort temperature control */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
              <Thermometer size={16} className="text-[var(--accent)]" />
              <span>Comfort</span>
              {awayActive && (
                <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-500 whitespace-nowrap">
                  Away{awayDays != null && awayDays > 0 ? ` · ${awayDays}d remaining` : ' mode active'}
                </span>
              )}
              {comfortScheduleActive && !awayActive && (
                <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-500 whitespace-nowrap">
                  Scheduled {comfortTempActive != null ? `${comfortTempActive.toFixed(1)}°` : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => adjustTemp(-0.5)}
                disabled={saving || localTemp <= 15}
                className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border border-[var(--border)] hover:bg-[var(--bg)] disabled:opacity-40"
              >
                <Minus size={14} />
              </button>
              <span className="text-xl font-bold w-16 text-center">
                {localTemp.toFixed(1)}°
              </span>
              <button
                onClick={() => adjustTemp(0.5)}
                disabled={saving || localTemp >= 25}
                className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border border-[var(--border)] hover:bg-[var(--bg)] disabled:opacity-40"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Shadow / Live mode toggle button */}
          <button
            onClick={() => setShowModal(true)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors',
              controlEnabled
                ? 'bg-green-500/10 border border-green-500/30 text-green-600 hover:bg-green-500/20'
                : 'bg-amber-500/10 border border-amber-500/30 text-amber-600 hover:bg-amber-500/20'
            )}
          >
            <div className={cn(
              'w-2 h-2 rounded-full',
              controlEnabled ? 'bg-green-500' : 'bg-amber-500'
            )} />
            {controlEnabled ? 'Live' : 'Shadow'}
          </button>
        </div>
      </div>

      {/* Modal overlay */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false) }}
        >
          <div className={cn(
            'w-full max-w-md mx-4 rounded-2xl border shadow-2xl p-4 sm:p-6',
            'bg-[var(--bg-card)] border-[var(--border)]',
            'animate-[fadeIn_150ms_ease-out]'
          )}>
            {/* Icon */}
            <div className={cn(
              'mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4',
              enablingLive
                ? 'bg-amber-500/15 text-amber-500'
                : 'bg-blue-500/15 text-blue-500'
            )}>
              {enablingLive
                ? <AlertTriangle size={24} />
                : <ShieldCheck size={24} />
              }
            </div>

            {/* Title */}
            <h2 className="text-lg font-bold text-center mb-2">
              {enablingLive ? 'Enable QSH Live Control?' : 'Switch to Shadow Mode?'}
            </h2>

            {/* Warning text */}
            <div className={cn(
              'rounded-lg px-4 py-3 text-sm mb-4',
              enablingLive
                ? 'bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300'
                : 'bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300'
            )}>
              {enablingLive ? (
                <>
                  <p className="font-semibold mb-1">QSH will actively control your heating system.</p>
                  <ul className="list-disc list-inside space-y-0.5 text-xs opacity-90">
                    <li>Heat pump flow temperature will be adjusted automatically</li>
                    <li>TRV positions will be set by the swarm optimiser</li>
                    <li>Operating mode (heat/cool/off) will be managed by QSH</li>
                  </ul>
                </>
              ) : (
                <>
                  <p className="font-semibold mb-1">QSH will switch to monitoring only.</p>
                  <ul className="list-disc list-inside space-y-0.5 text-xs opacity-90">
                    <li>No commands will be sent to the heat pump or TRVs</li>
                    <li>Dashboard will continue to display sensor data</li>
                    <li>You can re-enable live control at any time</li>
                  </ul>
                </>
              )}
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleModeConfirm}
                className={cn(
                  'flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors',
                  enablingLive
                    ? 'bg-amber-500 hover:bg-amber-600'
                    : 'bg-blue-500 hover:bg-blue-600'
                )}
              >
                {enablingLive ? 'Enable Live Control' : 'Switch to Shadow'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
})
