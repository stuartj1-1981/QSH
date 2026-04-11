import { useState } from 'react'
import { Loader2, Check, X, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../../lib/utils'
import { apiUrl } from '../../lib/api'
import { EntityPicker } from './EntityPicker'
import type { EnergyYaml, OctopusTestResponse, QshConfigYaml } from '../../types/config'

interface StepTariffProps {
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

type TariffMode = 'octopus' | 'fixed' | 'none'

const HP_EUID_PATTERN = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){7}$/

export function StepTariff({ config, onUpdate }: StepTariffProps) {
  const energy: EnergyYaml = config.energy || {}
  const [mode, setMode] = useState<TariffMode>(
    energy.octopus?.api_key ? 'octopus' : energy.fixed_rates ? 'fixed' : 'none'
  )
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<OctopusTestResponse | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const update = (changes: Partial<EnergyYaml>) => {
    onUpdate('energy', { ...energy, ...changes })
  }

  const updateOctopus = (changes: Partial<EnergyYaml['octopus']>) => {
    update({ octopus: { ...energy.octopus, ...changes } })
  }

  const updateOctopusRates = (changes: Partial<NonNullable<EnergyYaml['octopus']>['rates']>) => {
    updateOctopus({ rates: { ...energy.octopus?.rates, ...changes } })
  }

  const testOctopus = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const resp = await fetch(apiUrl('api/wizard/test-octopus'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: energy.octopus?.api_key || '',
          account_number: energy.octopus?.account_number || '',
        }),
      })
      if (!resp.ok) {
        const text = await resp.text()
        setTestResult({ success: false, message: `Server error ${resp.status}: ${text.slice(0, 120)}` })
        return
      }
      const data: OctopusTestResponse = await resp.json()
      setTestResult(data)
    } catch (e) {
      setTestResult({ success: false, message: `Network error: ${e instanceof Error ? e.message : e}` })
    } finally {
      setTesting(false)
    }
  }

  const hpEuid = energy.octopus?.hp_euid || ''
  const euidValid = !hpEuid || HP_EUID_PATTERN.test(hpEuid)

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">Energy Tariff</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Configure your energy tariff for cost-aware heating optimisation.
        </p>
      </div>

      {/* Mode selection */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { id: 'octopus' as const, label: 'Octopus Smart', desc: 'Agile, Go, Cosy, Flux' },
          { id: 'fixed' as const, label: 'Fixed Rate', desc: 'Single import/export rate' },
          { id: 'none' as const, label: 'Skip', desc: 'Use fallback rates' },
        ].map(({ id, label, desc }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={cn(
              'flex flex-col items-center gap-1 p-4 rounded-lg border text-sm transition-colors',
              mode === id
                ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                : 'border-[var(--border)] hover:border-[var(--accent)]/50'
            )}
          >
            <span className="font-medium">{label}</span>
            <span className="text-xs text-[var(--text-muted)]">{desc}</span>
          </button>
        ))}
      </div>

      {/* Octopus config */}
      {mode === 'octopus' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              API Key
            </label>
            <input
              type="password"
              value={energy.octopus?.api_key || ''}
              onChange={(e) => updateOctopus({ api_key: e.target.value })}
              placeholder="sk_live_..."
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Account Number
            </label>
            <input
              type="text"
              value={energy.octopus?.account_number || ''}
              onChange={(e) => updateOctopus({ account_number: e.target.value })}
              placeholder="A-1234ABCD"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>

          <button
            onClick={testOctopus}
            disabled={testing || !energy.octopus?.api_key || !energy.octopus?.account_number}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg)] disabled:opacity-50"
          >
            {testing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : null}
            Test Connection
          </button>

          {testResult && (
            <div
              className={cn(
                'flex items-center gap-2 p-3 rounded-lg text-sm',
                testResult.success
                  ? 'bg-[var(--green)]/10 text-[var(--green)]'
                  : 'bg-[var(--red)]/10 text-[var(--red)]'
              )}
            >
              {testResult.success ? <Check size={16} /> : <X size={16} />}
              {testResult.message}
            </div>
          )}

          {/* Advanced Octopus Settings */}
          {testResult?.success && (
            <div>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                Advanced Octopus Settings
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-4 pl-4 border-l-2 border-[var(--border)]">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text)] mb-1">
                      Heat Pump EUID
                    </label>
                    <input
                      type="text"
                      value={hpEuid}
                      onChange={(e) => updateOctopus({ hp_euid: e.target.value || undefined })}
                      placeholder="XX:XX:XX:XX:XX:XX:XX:XX"
                      className={cn(
                        'w-full px-2 py-1.5 rounded border bg-[var(--bg)] text-sm text-[var(--text)]',
                        !euidValid ? 'border-[var(--red)]' : 'border-[var(--border)]'
                      )}
                    />
                    {!euidValid && (
                      <p className="text-xs text-[var(--red)] mt-1">
                        Expected format: XX:XX:XX:XX:XX:XX:XX:XX (8 hex pairs)
                      </p>
                    )}
                  </div>

                  <EntityPicker
                    slot="octopus_zone"
                    label="Zone Entity ID"
                    value={energy.octopus?.zone_entity_id || ''}
                    onChange={(v) => updateOctopus({ zone_entity_id: v || undefined })}
                    candidates={[]}
                  />

                  <div className="space-y-3">
                    <h4 className="text-xs font-medium text-[var(--text)]">Rate Entities</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <EntityPicker
                        slot="octopus_rates_current"
                        label="Current Day Rates"
                        value={energy.octopus?.rates?.current_day || ''}
                        onChange={(v) => updateOctopusRates({ current_day: v || undefined })}
                        candidates={[]}
                      />
                      <EntityPicker
                        slot="octopus_rates_next"
                        label="Next Day Rates"
                        value={energy.octopus?.rates?.next_day || ''}
                        onChange={(v) => updateOctopusRates({ next_day: v || undefined })}
                        candidates={[]}
                      />
                      <EntityPicker
                        slot="octopus_rates_export_current"
                        label="Current Day Export Rates"
                        value={energy.octopus?.rates?.current_day_export || ''}
                        onChange={(v) => updateOctopusRates({ current_day_export: v || undefined })}
                        candidates={[]}
                      />
                      <EntityPicker
                        slot="octopus_rates_export_next"
                        label="Next Day Export Rates"
                        value={energy.octopus?.rates?.next_day_export || ''}
                        onChange={(v) => updateOctopusRates({ next_day_export: v || undefined })}
                        candidates={[]}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Fixed rate config */}
      {mode === 'fixed' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Import Rate (p/kWh)
            </label>
            <input
              type="number"
              step="0.001"
              value={energy.fixed_rates?.import_rate ?? 0.245}
              onChange={(e) =>
                update({
                  fixed_rates: {
                    ...energy.fixed_rates,
                    import_rate: parseFloat(e.target.value) || 0,
                  },
                })
              }
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Export Rate (p/kWh)
            </label>
            <input
              type="number"
              step="0.001"
              value={energy.fixed_rates?.export_rate ?? 0}
              onChange={(e) =>
                update({
                  fixed_rates: {
                    ...energy.fixed_rates,
                    export_rate: parseFloat(e.target.value) || 0,
                  },
                })
              }
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
        </div>
      )}

      {/* Fallback rates */}
      <div>
        <h3 className="text-sm font-medium text-[var(--text)] mb-2">
          Fallback Rates (used when live rates unavailable)
        </h3>
        <div className="grid grid-cols-4 gap-3">
          {(['cheap', 'standard', 'peak', 'export'] as const).map((tier) => (
            <div key={tier}>
              <label className="block text-xs font-medium text-[var(--text)] mb-1 capitalize">
                {tier}
              </label>
              <input
                type="number"
                step="0.01"
                value={energy.fallback_rates?.[tier] ?? ''}
                onChange={(e) =>
                  update({
                    fallback_rates: {
                      ...energy.fallback_rates,
                      [tier]: parseFloat(e.target.value) || 0,
                    },
                  })
                }
                placeholder={
                  tier === 'cheap' ? '0.15' : tier === 'standard' ? '0.30' : tier === 'peak' ? '0.46' : '0.15'
                }
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
