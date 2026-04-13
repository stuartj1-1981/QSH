import { useState, useEffect } from 'react'
import { Save, Loader2, Check, X, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../../lib/utils'
import { apiUrl } from '../../lib/api'
import { usePatchConfig } from '../../hooks/useConfig'
import { EntityField } from './EntityField'
import { HelpTip } from '../HelpTip'
import { TARIFF } from '../../lib/helpText'
import type { EnergyYaml, HeatSourceYaml, OctopusTestResponse, Driver } from '../../types/config'

type TariffMode = 'octopus' | 'fixed' | 'none'
type OctopusMode = 'ha_integration' | 'direct_api'

const HP_EUID_PATTERN = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){7}$/

interface TariffSettingsProps {
  energy: EnergyYaml
  heatSource?: HeatSourceYaml
  driver: Driver
  onRefetch: () => void
}

export function TariffSettings({ energy: initial, heatSource: initialHs, driver, onRefetch }: TariffSettingsProps) {
  const [energy, setEnergy] = useState<EnergyYaml>(initial)
  const [mode, setMode] = useState<TariffMode>(
    initial.octopus?.api_key ? 'octopus' : initial.fixed_rates ? 'fixed' : 'none'
  )
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<OctopusTestResponse | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [hs, setHs] = useState<HeatSourceYaml | undefined>(initialHs)
  const inferredOctopusMode: OctopusMode = initial.octopus?.zone_entity_id ? 'ha_integration' : 'direct_api'
  const [octopusMode, setOctopusMode] = useState<OctopusMode>(driver === 'mqtt' ? 'direct_api' : inferredOctopusMode)
  const [showModeChange, setShowModeChange] = useState(false)
  const { patch, saving } = usePatchConfig()

  useEffect(() => { setEnergy(initial) }, [initial])
  useEffect(() => { setHs(initialHs) }, [initialHs])

  const save = async () => {
    // Build payload based on active mode — clear the other mode's data
    const payload: EnergyYaml = { fallback_rates: energy.fallback_rates }
    if (mode === 'octopus') {
      payload.octopus = energy.octopus
    } else if (mode === 'fixed') {
      payload.fixed_rates = energy.fixed_rates
    }
    const result = await patch('energy', payload)
    // Also persist weather comp changes to heat_source section
    if (result && hs) {
      await patch('heat_source', hs)
    }
    if (result) onRefetch()
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">Energy Tariff</h2>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      {/* Mode selection */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { id: 'octopus' as const, label: 'Octopus Smart', desc: 'Agile, Go, Cosy, Flux' },
          { id: 'fixed' as const, label: 'Fixed Rate', desc: 'Single import/export rate' },
          { id: 'none' as const, label: 'None', desc: 'Use fallback rates only' },
        ].map(({ id, label, desc }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={cn(
              'flex flex-col items-center gap-1 p-3 rounded-lg border text-sm transition-colors',
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
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
          <h3 className="text-sm font-medium text-[var(--text)]">Octopus Energy</h3>

          {/* Octopus mode badge */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">Mode:</span>
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-[var(--accent)]/10 text-[var(--accent)]">
              {octopusMode === 'ha_integration' ? 'HA Integration' : 'Direct API'}
            </span>
            {driver === 'ha' && !showModeChange && (
              <button
                type="button"
                onClick={() => setShowModeChange(true)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] underline"
              >
                Change mode
              </button>
            )}
          </div>

          {driver === 'ha' && showModeChange && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
              <select
                value={octopusMode}
                onChange={(e) => setOctopusMode(e.target.value as OctopusMode)}
                className="px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              >
                <option value="direct_api">Direct API</option>
                <option value="ha_integration">HA Integration</option>
              </select>
              <button
                type="button"
                onClick={() => setShowModeChange(false)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                Done
              </button>
            </div>
          )}

          {driver === 'mqtt' && (
            <div className="p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text-muted)]">
              HA Octopus Energy integration is unavailable on MQTT driver. Configure Direct API access
              above using your Octopus account number and API key.
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">API Key</label>
              <input
                type="password"
                value={energy.octopus?.api_key || ''}
                onChange={(e) =>
                  setEnergy(prev => ({
                    ...prev,
                    octopus: { ...prev.octopus, api_key: e.target.value },
                  }))
                }
                placeholder="sk_live_..."
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Account Number</label>
              <input
                type="text"
                value={energy.octopus?.account_number || ''}
                onChange={(e) =>
                  setEnergy(prev => ({
                    ...prev,
                    octopus: { ...prev.octopus, account_number: e.target.value },
                  }))
                }
                placeholder="A-1234ABCD"
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={testOctopus}
              disabled={testing || !energy.octopus?.api_key || !energy.octopus?.account_number}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg)] disabled:opacity-50"
            >
              {testing && <Loader2 size={14} className="animate-spin" />}
              Test Connection
            </button>
            {testResult && (
              <div
                className={cn(
                  'flex items-center gap-2 text-sm',
                  testResult.success ? 'text-[var(--green)]' : 'text-[var(--red)]'
                )}
              >
                {testResult.success ? <Check size={14} /> : <X size={14} />}
                {testResult.message}
              </div>
            )}
          </div>

          {/* Advanced Octopus Settings */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Advanced Octopus Settings
          </button>

          {showAdvanced && (
            <div className="space-y-3 pl-4 border-l-2 border-[var(--border)]">
              <div>
                <label className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-1">
                  Heat Pump EUID <HelpTip text={TARIFF.hpEuid} size={12} />
                </label>
                <input
                  type="text"
                  value={hpEuid}
                  onChange={(e) =>
                    setEnergy(prev => ({
                      ...prev,
                      octopus: { ...prev.octopus, hp_euid: e.target.value || undefined },
                    }))
                  }
                  placeholder="XX:XX:XX:XX:XX:XX:XX:XX"
                  className={cn(
                    'w-full px-2 py-1.5 rounded border bg-[var(--bg)] text-sm text-[var(--text)]',
                    !euidValid ? 'border-[var(--red)]' : 'border-[var(--border)]'
                  )}
                />
                {!euidValid && (
                  <p className="text-xs text-[var(--red)] mt-1">
                    Expected format: XX:XX:XX:XX:XX:XX:XX:XX
                  </p>
                )}
              </div>

              {driver === 'ha' && octopusMode === 'ha_integration' && (
                <>
                  <EntityField
                    label="Zone Entity ID"
                    value={energy.octopus?.zone_entity_id || ''}
                    onChange={(v) =>
                      setEnergy(prev => ({
                        ...prev,
                        octopus: { ...prev.octopus, zone_entity_id: v || undefined },
                      }))
                    }
                    placeholder="climate.octopus_heat_pump_zone"
                  />

                  <h4 className="text-xs font-medium text-[var(--text)]">Rate Entities</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <EntityField
                      label="Current Day Rates"
                      value={energy.octopus?.rates?.current_day || ''}
                      onChange={(v) =>
                        setEnergy(prev => ({
                          ...prev,
                          octopus: {
                            ...prev.octopus,
                            rates: { ...prev.octopus?.rates, current_day: v || undefined },
                          },
                        }))
                      }
                      placeholder="event.current_day_rates"
                    />
                    <EntityField
                      label="Next Day Rates"
                      value={energy.octopus?.rates?.next_day || ''}
                      onChange={(v) =>
                        setEnergy(prev => ({
                          ...prev,
                          octopus: {
                            ...prev.octopus,
                            rates: { ...prev.octopus?.rates, next_day: v || undefined },
                          },
                        }))
                      }
                      placeholder="event.next_day_rates"
                    />
                    <EntityField
                      label="Current Day Export"
                      value={energy.octopus?.rates?.current_day_export || ''}
                      onChange={(v) =>
                        setEnergy(prev => ({
                          ...prev,
                          octopus: {
                            ...prev.octopus,
                            rates: { ...prev.octopus?.rates, current_day_export: v || undefined },
                          },
                        }))
                      }
                      placeholder="event.export_current_day_rates"
                    />
                    <EntityField
                      label="Next Day Export"
                      value={energy.octopus?.rates?.next_day_export || ''}
                      onChange={(v) =>
                        setEnergy(prev => ({
                          ...prev,
                          octopus: {
                            ...prev.octopus,
                            rates: { ...prev.octopus?.rates, next_day_export: v || undefined },
                          },
                        }))
                      }
                      placeholder="event.export_next_day_rates"
                    />
                  </div>
                </>
              )}

              {/* Weather Compensation */}
              {hs && (
                <>
                  <h4 className="text-xs font-medium text-[var(--text)] mt-2">Weather Compensation</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
                        Weather Comp Enabled <HelpTip text={TARIFF.weatherComp} size={12} />
                      </label>
                      <select
                        value={
                          (hs.flow_control?.base_data as Record<string, unknown> | undefined)?.weather_comp_enabled === true
                            ? 'true'
                            : 'false'
                        }
                        onChange={(e) =>
                          setHs(prev => prev ? ({
                            ...prev,
                            flow_control: {
                              ...prev.flow_control,
                              base_data: {
                                ...(prev.flow_control?.base_data || {}),
                                weather_comp_enabled: e.target.value === 'true',
                              },
                            },
                          }) : prev)
                        }
                        className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                      >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </div>
                    <div>
                      <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
                        Fixed Flow Temperature <HelpTip text={TARIFF.fixedFlowTemp} size={12} />
                      </label>
                      <input
                        type="number"
                        value={String((hs.flow_control?.base_data as Record<string, unknown> | undefined)?.fixed_flow_temperature ?? '')}
                        onChange={(e) =>
                          setHs(prev => prev ? ({
                            ...prev,
                            flow_control: {
                              ...prev.flow_control,
                              base_data: {
                                ...(prev.flow_control?.base_data || {}),
                                fixed_flow_temperature: parseFloat(e.target.value) || undefined,
                              },
                            },
                          }) : prev)
                        }
                        className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text)] mb-1">
                        Min Temperature
                      </label>
                      <input
                        type="number"
                        value={
                          String((hs.flow_control?.base_data as Record<string, unknown> | undefined)?.weather_comp_min_temperature ?? '')
                        }
                        onChange={(e) =>
                          setHs(prev => prev ? ({
                            ...prev,
                            flow_control: {
                              ...prev.flow_control,
                              base_data: {
                                ...(prev.flow_control?.base_data || {}),
                                weather_comp_min_temperature: parseFloat(e.target.value) || undefined,
                              },
                            },
                          }) : prev)
                        }
                        className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text)] mb-1">
                        Max Temperature
                      </label>
                      <input
                        type="number"
                        value={
                          String((hs.flow_control?.base_data as Record<string, unknown> | undefined)?.weather_comp_max_temperature ?? '')
                        }
                        onChange={(e) =>
                          setHs(prev => prev ? ({
                            ...prev,
                            flow_control: {
                              ...prev.flow_control,
                              base_data: {
                                ...(prev.flow_control?.base_data || {}),
                                weather_comp_max_temperature: parseFloat(e.target.value) || undefined,
                              },
                            },
                          }) : prev)
                        }
                        className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Fixed rates */}
      {mode === 'fixed' && (
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
          <h3 className="text-sm font-medium text-[var(--text)]">Fixed Rates</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-1">
                Import Rate (p/kWh) <HelpTip text={TARIFF.importRate} size={12} />
              </label>
              <input
                type="number"
                step="0.001"
                value={energy.fixed_rates?.import_rate ?? ''}
                onChange={(e) =>
                  setEnergy(prev => ({
                    ...prev,
                    fixed_rates: {
                      ...prev.fixed_rates,
                      import_rate: parseFloat(e.target.value) || 0,
                    },
                  }))
                }
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-1">
                Export Rate (p/kWh) <HelpTip text={TARIFF.exportRate} size={12} />
              </label>
              <input
                type="number"
                step="0.001"
                value={energy.fixed_rates?.export_rate ?? ''}
                onChange={(e) =>
                  setEnergy(prev => ({
                    ...prev,
                    fixed_rates: {
                      ...prev.fixed_rates,
                      export_rate: parseFloat(e.target.value) || 0,
                    },
                  }))
                }
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
            </div>
          </div>
        </div>
      )}

      {/* Fallback rates */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <h3 className="text-sm font-medium text-[var(--text)] flex items-center gap-1">
          Fallback Rates
          <span className="font-normal text-[var(--text-muted)] ml-1">(used when live rates unavailable)</span>
          <HelpTip text={TARIFF.fallbackRates} size={12} />
        </h3>
        <div className="grid grid-cols-4 gap-3">
          {(['cheap', 'standard', 'peak', 'export'] as const).map((tier) => (
            <div key={tier}>
              <label className="block text-xs text-[var(--text-muted)] mb-1 capitalize">
                {tier}
              </label>
              <input
                type="number"
                step="0.01"
                value={energy.fallback_rates?.[tier] ?? ''}
                onChange={(e) =>
                  setEnergy(prev => ({
                    ...prev,
                    fallback_rates: {
                      ...prev.fallback_rates,
                      [tier]: parseFloat(e.target.value) || 0,
                    },
                  }))
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
