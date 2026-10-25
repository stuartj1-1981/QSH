import { useState, useEffect } from 'react'
import { BarChart3 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { UK_REGIONS } from '../../lib/regions'
import { telemetryLocationFields } from '../../lib/locationLevels'
import { LocationLevelChooser } from '../LocationLevelChooser'
import type { LocationLevel, QshConfigYaml } from '../../types/config'

interface StepTelemetryAgreementProps {
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

export function StepTelemetryAgreement({ config, onUpdate }: StepTelemetryAgreementProps) {
  const existingRegion = config.telemetry?.region ?? ''
  const isUkRegion = UK_REGIONS.includes(existingRegion as typeof UK_REGIONS[number])

  const [agreed, setAgreed] = useState(config.telemetry?.agreed ?? false)
  const [regionMode, setRegionMode] = useState<'uk' | 'international'>(
    existingRegion && !isUkRegion ? 'international' : 'uk'
  )
  const [region, setRegion] = useState(existingRegion)
  const [locationLevel, setLocationLevel] = useState<LocationLevel>(
    config.telemetry?.location_level ?? 'region'
  )
  const [locationCode, setLocationCode] = useState(config.telemetry?.location_code ?? '')
  const [detailsOpen, setDetailsOpen] = useState(false)

  useEffect(() => {
    onUpdate('telemetry', {
      agreed,
      region: agreed ? region : undefined,
      ...telemetryLocationFields(agreed, regionMode, locationLevel, locationCode),
    })
  }, [agreed, region, regionMode, locationLevel, locationCode, onUpdate])

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <BarChart3 size={28} className="text-[var(--accent)]" />
        <h2 className="text-xl font-bold text-[var(--text)]">Fleet Data Sharing</h2>
      </div>

      <p className="text-sm text-[var(--text-muted)] leading-relaxed">
        QSH collects operational data from installations that agree to share it. This data —
        thermal parameters, heat pump performance, room temperatures and target temperatures,
        energy metrics, and the location detail you choose below — is used to improve the
        algorithms for everyone. Room names are replaced with indices. QSH does not ask for
        your name, your address or your full postcode.
      </p>

      {/* Expandable details */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--text)]"
        >
          <span>What exactly is collected?</span>
          <span className="text-[var(--text-muted)]">{detailsOpen ? '−' : '+'}</span>
        </button>
        {detailsOpen && (
          <ul className="space-y-2 px-4 pb-4 text-sm text-[var(--text-muted)]">
            <li><strong className="text-[var(--text)]">Thermal parameters</strong> — learned heat loss, thermal mass, and solar gain per zone</li>
            <li><strong className="text-[var(--text)]">Building metadata</strong> — approximate floor area, zone count, emitter types; construction year, fabric class and storeys if you entered them</li>
            <li><strong className="text-[var(--text)]">Heat sources</strong> — type, fuel type, declared output, and the label in your configuration</li>
            <li><strong className="text-[var(--text)]">Location</strong> — your region; the first part of your postcode, or the first part and the next digit, only if you choose that below</li>
            <li><strong className="text-[var(--text)]">Control performance</strong> — optimisation blend factor, comfort and efficiency scores</li>
            <li><strong className="text-[var(--text)]">Energy metrics</strong> — daily consumption (kWh), COP, normalised cost per degree-hour</li>
            <li><strong className="text-[var(--text)]">Operating state, about every 15 minutes</strong> — outdoor temperature, heat pump readings, and each zone's indoor temperature, target temperature and valve position</li>
            <li><strong className="text-[var(--text)]">Events</strong> — fast outdoor temperature changes, the heat pump turning on or off, target temperature changes, QSH control turned on or off, alarms clearing, and controller health events</li>
            <li><strong className="text-[var(--text)]">Equipment present</strong> — which optional sensors and integrations the installation has</li>
            <li><strong className="text-[var(--text)]">Software and connection</strong> — the QSH version, the time QSH last started, the time of each message</li>
          </ul>
        )}
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
          Share operational data to help improve QSH for everyone
        </span>
      </div>

      {/* Conditional content based on toggle */}
      {agreed ? (
        <div className="space-y-4">
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
                setLocationLevel('region')
                setLocationCode('')
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

          <LocationLevelChooser
            regionMode={regionMode}
            level={locationLevel}
            code={locationCode}
            onChange={(level, code) => {
              setLocationLevel(level)
              setLocationCode(code)
            }}
          />
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)] italic">
          QSH will run without sending fleet data. You can enable data sharing later in Settings.
        </p>
      )}

      {/* Privacy policy link */}
      <a
        href="https://github.com/stuartj1-1981/QSH/blob/main/docs/privacy.md"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs text-[var(--accent)] hover:underline"
      >
        Read the full privacy policy
      </a>
    </div>
  )
}
