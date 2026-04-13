// Driver-agnostic: this component exposes no HA entity IDs or MQTT topics. Audited INSTRUCTION-88D.
import { useState, useEffect } from 'react'
import { Save, Loader2, BarChart3 } from 'lucide-react'
import { usePatchConfig } from '../../hooks/useConfig'
import { UK_REGIONS } from '../../lib/regions'
import { cn } from '../../lib/utils'
import type { TelemetryYaml, Driver } from '../../types/config'

interface DataSharingSettingsProps {
  telemetry?: TelemetryYaml
  disclaimerAccepted?: boolean
  driver: Driver
  onRefetch: () => void
}

// driver threaded in 88B; consumed in 88C/88D via rename to `driver`
export function DataSharingSettings({
  telemetry: initial,
  disclaimerAccepted: initialDisclaimer,
  driver: _driver,
  onRefetch,
}: DataSharingSettingsProps) {
  const existingRegion = initial?.region ?? ''
  const isUkRegion = UK_REGIONS.includes(existingRegion as typeof UK_REGIONS[number])

  const [agreed, setAgreed] = useState(initial?.agreed ?? false)
  const [regionMode, setRegionMode] = useState<'uk' | 'international'>(
    existingRegion && !isUkRegion ? 'international' : 'uk'
  )
  const [region, setRegion] = useState(existingRegion)
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(initialDisclaimer ?? false)
  const [showRestartNotice, setShowRestartNotice] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local form state from refetched config is intentional
    setAgreed(initial?.agreed ?? false)
  }, [initial])
  useEffect(() => {
    const r = initial?.region ?? ''
    const isUk = UK_REGIONS.includes(r as typeof UK_REGIONS[number])
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local form state from refetched config is intentional
    setRegionMode(r && !isUk ? 'international' : 'uk')
    setRegion(r)
  }, [initial])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local form state from refetched config is intentional
    setDisclaimerAccepted(initialDisclaimer ?? false)
  }, [initialDisclaimer])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const { patch, saving, error } = usePatchConfig()

  const save = async () => {
    setValidationError(null)

    if (agreed) {
      if (!region) {
        setValidationError('Please select or enter your region')
        return
      }
      if (!disclaimerAccepted) {
        setValidationError('Please accept the disclaimer to enable data sharing')
        return
      }
    }

    const r1 = await patch('telemetry', { agreed, region: agreed ? region : undefined })
    if (!r1) return
    const r2 = await patch('disclaimer_accepted', disclaimerAccepted)
    if (!r2) return
    onRefetch()
    setShowRestartNotice(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">Data Sharing</h2>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      {/* Validation / API errors */}
      {(validationError || error) && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-sm text-red-600">
          {validationError || error}
        </div>
      )}

      {/* Restart notice */}
      {showRestartNotice && (
        <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/5 text-sm text-green-700">
          Changes take effect after restart. The pipeline will restart automatically.
        </div>
      )}

      {/* Telemetry section */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <div className="flex items-center gap-3">
          <BarChart3 size={20} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--text)]">Fleet Data Sharing</span>
        </div>

        {/* Toggle */}
        <div className="flex items-center gap-3">
          <button
            role="switch"
            aria-checked={agreed}
            onClick={() => setAgreed((v) => !v)}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors',
              agreed ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5',
                agreed ? 'translate-x-[22px]' : 'translate-x-0.5'
              )}
            />
          </button>
          <span className="text-sm text-[var(--text)]">
            Share anonymised operational data to help improve QSH for everyone
          </span>
        </div>

        {/* Conditional content based on toggle */}
        {agreed ? (
          <div className="space-y-4 pl-4 border-l-2 border-[var(--border)]">
            {/* UK / International tab toggle */}
            <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1 w-fit">
              <button
                type="button"
                onClick={() => {
                  setRegionMode('uk')
                  setRegion('')
                }}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  regionMode === 'uk'
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                )}
              >
                UK
              </button>
              <button
                type="button"
                onClick={() => {
                  setRegionMode('international')
                  setRegion('')
                }}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  regionMode === 'international'
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                )}
              >
                International
              </button>
            </div>

            {regionMode === 'uk' ? (
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
              >
                <option value="">Select your region</option>
                {UK_REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="e.g. Northern France, Southern Ontario"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)] italic">
            QSH runs without sending fleet data.
          </p>
        )}

        {/* Advanced status — collapsed by default */}
        {initial?.install_id && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              {showAdvanced ? 'Hide details' : 'Show details'}
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                <p>Install ID: {initial.install_id.slice(0, 8)}...</p>
                {initial.api_token ? (
                  <p>Status: Registered</p>
                ) : (
                  <p>Status: Not yet registered</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Disclaimer section */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <span className="text-sm font-semibold text-[var(--text)]">Beta Disclaimer</span>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={disclaimerAccepted}
            onChange={(e) => setDisclaimerAccepted(e.target.checked)}
            className="accent-[var(--accent)] mt-0.5"
          />
          <span className="text-sm text-[var(--text)]">
            I understand and accept the beta software terms
          </span>
        </label>

        <details className="text-xs text-[var(--text-muted)]">
          <summary className="cursor-pointer hover:text-[var(--text)]">View full disclaimer</summary>
          <p className="mt-2 leading-relaxed">
            QSH is beta software. It is not a replacement for professional heating system
            design or installer commissioning. Your heat pump's native controls remain active
            at all times — if QSH stops for any reason, your heating system continues operating
            on its manufacturer's settings. By proceeding you acknowledge that you are responsible
            for monitoring your heating system and that you use QSH at your own risk.
          </p>
        </details>
      </div>

      {/* Privacy policy link */}
      <a
        href="https://github.com/stuartj1-1981/Quantum-Swarm-Heating/blob/main/docs/privacy.md"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs text-[var(--accent)] hover:underline"
      >
        Read the full privacy policy
      </a>
    </div>
  )
}
