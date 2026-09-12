// Driver-agnostic: this component exposes no HA entity IDs or MQTT topics. Audited INSTRUCTION-88D.
import { useState } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { usePatchConfig } from '../../hooks/useConfig'
import { useHistorianSetup } from '../../hooks/useHistorianSetup'
import {
  applyHistorianAction,
  deriveHistorianMode,
  type HistorianAction,
} from '../../lib/historianMode'
import { HistorianChoice } from './HistorianChoice'
import type { HistorianYaml, Driver } from '../../types/config'

interface HistorianSettingsProps {
  historian?: HistorianYaml
  driver: Driver
  onRefetch: () => void
}

const CANNOT_READ = 'QSH cannot read the historian state now. Try again.'
const STATE_CHANGED =
  'The historian state changed. Read the new state, then save again.'

// driver threaded in 88B; consumed in 88C/88D via rename to `driver`
export function HistorianSettings({
  historian: initial,
  driver: _driver,
  onRefetch,
}: HistorianSettingsProps) {
  // An absent or empty section is `{}` — Settings renders this panel only
  // after the config has loaded (INSTRUCTION-524B §1.5).
  const section: HistorianYaml = initial ?? {}

  const { patch, saving } = usePatchConfig()
  const { data: setup, error, refresh, fetchNow } = useHistorianSetup()

  const [action, setAction] = useState<HistorianAction | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // Reset the pending action when a newly loaded section arrives. Done as a
  // render-time adjustment rather than in an effect: an effect that calls
  // setState unconditionally cascades a second render, which
  // react-hooks/set-state-in-effect rejects.
  const [seen, setSeen] = useState(initial)
  if (initial !== seen) {
    setSeen(initial)
    setAction(null)
    setMessage(null)
  }

  const mode = deriveHistorianMode(section, setup)

  const checked =
    action === 'enable' || action === 'use_builtin' || action === 'resume'
      ? true
      : action === 'disable'
        ? false
        : section.enabled === true

  const save = async () => {
    setMessage(null)

    // Read the state at the moment of writing, not the one the card was
    // drawn from: an unread record may have been read, or a migration may
    // have started, since this panel mounted.
    const fresh = await fetchNow()
    if (fresh === null) {
      setMessage(CANNOT_READ)
      return
    }
    if (deriveHistorianMode(section, fresh) !== mode) {
      setMessage(STATE_CHANGED)
      return
    }
    if (action === null) return

    const body = applyHistorianAction(section, mode, action)
    if (body !== null) {
      const result = await patch('historian', body)
      if (!result) return
    }
    setAction(null)
    onRefetch()
    refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">Historian</h2>
        <button
          onClick={save}
          disabled={saving || action === null || mode === 'unknown'}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <HistorianChoice
          section={section}
          setup={setup}
          error={error}
          checked={checked}
          onAction={setAction}
          onRetry={refresh}
        />
        {message && <p className="text-sm text-[var(--red)]">{message}</p>}
      </div>
    </div>
  )
}
