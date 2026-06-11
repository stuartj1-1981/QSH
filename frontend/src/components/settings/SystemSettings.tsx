// Driver-agnostic: this component exposes no HA entity IDs or MQTT topics. Audited INSTRUCTION-88D.
import { useState } from 'react'
import { Download, Wand2, Save, Loader2 } from 'lucide-react'
import { apiUrl } from '../../lib/api'
import { usePatchConfig } from '../../hooks/useConfig'
import type { Driver } from '../../types/config'

interface SystemSettingsProps {
  driver: Driver
  /** INSTRUCTION-327 — current top-level schedule_timezone from raw config. */
  scheduleTimezone?: string
  onRefetch?: () => void
  onRunWizard: () => void
}

// INSTRUCTION-327 — client-side SHAPE check only; the backend validates the
// zone authoritatively against tzdata at PATCH time and config load. Segment
// quantifier is `*` (not `+`) so single-token IANA keys (UTC, GMT, legacy
// names) pass.
const TZ_SHAPE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/

// driver threaded in 88B; consumed in 88C/88D via rename to `driver`
export function SystemSettings({ driver: _driver, scheduleTimezone, onRefetch, onRunWizard }: SystemSettingsProps) {
  const [tz, setTz] = useState(scheduleTimezone ?? '')
  const { patch, saving, error: patchError } = usePatchConfig()
  const [shapeError, setShapeError] = useState<string | null>(null)

  // Render-time prop sync (the Schedule.tsx syncKey idiom) — resets the local
  // field when the refetched config delivers a new value, without the
  // setState-in-effect cascade the react-hooks rule rejects.
  const [syncedFrom, setSyncedFrom] = useState(scheduleTimezone ?? '')
  if ((scheduleTimezone ?? '') !== syncedFrom) {
    setSyncedFrom(scheduleTimezone ?? '')
    setTz(scheduleTimezone ?? '')
  }

  const tzDirty = tz.trim() !== (scheduleTimezone ?? '')

  const saveTimezone = async () => {
    const value = tz.trim()
    if (value && !TZ_SHAPE.test(value)) {
      setShapeError('Not a valid IANA zone name shape (e.g. Europe/London or UTC)')
      return
    }
    setShapeError(null)
    const result = await patch('root', { schedule_timezone: value })
    if (result) onRefetch?.()
  }

  const downloadConfig = async () => {
    try {
      const resp = await fetch(apiUrl('api/config/raw'))
      const data = await resp.json()
      const yaml = JSON.stringify(data, null, 2)
      const blob = new Blob([yaml], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'qsh_config.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // Ignore
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-[var(--text)]">System</h2>

      <div className="space-y-4">
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
          <h3 className="text-sm font-medium text-[var(--text)]">Schedule Timezone</h3>
          <p className="text-xs text-[var(--text-muted)]">
            IANA timezone used by comfort and occupancy schedules when no Home Assistant
            Supervisor is present (e.g. plain Docker installs). Leave blank for automatic
            resolution (Supervisor → TZ env var → UTC). The value is validated
            authoritatively at backend config load — unknown or malformed zones warn
            and are ignored.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={tz}
              onChange={(e) => { setTz(e.target.value); setShapeError(null) }}
              placeholder="Europe/London"
              aria-label="Schedule timezone"
              className="flex-1 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
            <button
              onClick={saveTimezone}
              disabled={saving || !tzDirty}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save
            </button>
          </div>
          {shapeError && (
            <p className="text-xs text-red-500">{shapeError}</p>
          )}
          {patchError && (
            <p className="text-xs text-red-500">{patchError}</p>
          )}
        </div>

        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
          <h3 className="text-sm font-medium text-[var(--text)]">Export Configuration</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Download the current qsh.yaml configuration as JSON.
          </p>
          <button
            onClick={downloadConfig}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--text)] hover:bg-[var(--bg)]"
          >
            <Download size={14} />
            Download Config
          </button>
        </div>

        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
          <h3 className="text-sm font-medium text-[var(--text)]">Setup Wizard</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Re-run the guided setup wizard to reconfigure QSH from scratch.
          </p>
          <button
            onClick={onRunWizard}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--accent)] text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/5"
          >
            <Wand2 size={14} />
            Re-run Setup Wizard
          </button>
        </div>
      </div>
    </div>
  )
}
