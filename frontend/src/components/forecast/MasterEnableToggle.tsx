import { useState, useCallback } from 'react'
import { Power } from 'lucide-react'
import { cn } from '../../lib/utils'
import { apiUrl } from '../../lib/api'

interface MasterEnableToggleProps {
  value: boolean
  onChange?: () => void
}

export function MasterEnableToggle({ value, onChange }: MasterEnableToggleProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleToggle = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const resp = await fetch(
        apiUrl('api/control/forecast-master-enable'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !value }),
        },
      )
      if (!resp.ok) {
        throw new Error(`POST failed: ${resp.status}`)
      }
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Toggle failed')
    } finally {
      setBusy(false)
    }
  }, [value, onChange])

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 bg-[var(--bg-card)] rounded-lg border border-[var(--border)] w-full sm:w-auto">
      <div className="flex items-center gap-3 sm:contents">
        <Power
          size={24}
          className={cn(
            value ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]',
          )}
        />
        {/* MOBILE-ONLY heading — paired with the sm:block heading in the
            description block below. Keep both strings identical. If one is
            edited, edit the other in the same commit. */}
        <div className="font-semibold text-[var(--text)] sm:hidden">
          Enable Forecast
        </div>
      </div>
      <div className="flex-1 min-w-0">
        {/* DESKTOP-ONLY heading — paired with the sm:hidden heading in the
            icon row above. Keep both strings identical. If one is edited,
            edit the other in the same commit. */}
        <div className="font-semibold text-[var(--text)] hidden sm:block">
          Enable Forecast
        </div>
        <div className="text-sm text-[var(--text-muted)]">
          {value
            ? 'Forecast is on. Heating decisions can be influenced by predicted weather and load.'
            : 'Forecast is off. Heating runs from the deterministic controllers only.'}
        </div>
        {error && (
          <div className="text-sm text-red-500 mt-1" role="alert">
            {error}
          </div>
        )}
      </div>
      <button
        onClick={handleToggle}
        disabled={busy}
        className={cn(
          'px-4 py-2 min-h-[44px] min-w-[64px] rounded font-medium',
          value
            ? 'bg-[var(--accent)] text-white'
            : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]',
          busy && 'opacity-50 cursor-wait',
        )}
        aria-pressed={value}
      >
        {busy ? '...' : value ? 'ON' : 'OFF'}
      </button>
    </div>
  )
}
