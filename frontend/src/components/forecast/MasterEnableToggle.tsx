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
    <div className="flex items-center gap-3 p-4 bg-[var(--bg-card)] rounded-lg border border-[var(--border)]">
      <Power
        size={24}
        className={cn(
          value ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]',
        )}
      />
      <div className="flex-1">
        <div className="font-semibold text-[var(--text)]">
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
          'px-4 py-2 rounded font-medium',
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
