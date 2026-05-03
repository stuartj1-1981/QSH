/**
 * INSTRUCTION-150E Task 4: Tariff settings — provider-aware editor mirror
 * of the wizard step, plus a live Provider Status panel beneath.
 *
 * - Per-fuel provider radio (electricity: Octopus / EDF / Fixed; gas:
 *   Octopus Tracker / Fixed; LPG/oil: Fixed only).
 * - EDF radio gated on `useTariffStatus().edfFreephaseSupported` — V5
 *   E-M1 backend capability flag, NOT current configuration.
 * - Provider Status panel below the editor renders
 *   `ProviderStatus.tariff_label` directly (V5 C-2 / V2 E-M4) — backend
 *   owns the display string. Falls back to a small cosmetic
 *   capitalisation map for `tariff_label === null` (cold start, fallback
 *   provider).
 * - Stale providers get a subtle warning indicator; non-null
 *   `last_error` shows the message in a muted secondary line.
 */
import { useState, useEffect } from 'react'
import { Save, Loader2, Check, X, AlertTriangle } from 'lucide-react'
import { cn } from '../../lib/utils'
import { apiUrl } from '../../lib/api'
import { usePatchConfig } from '../../hooks/useConfig'
import { useTariffStatus } from '../../hooks/useTariffStatus'
import { testEdfRegionResponseSchema } from '../../types/schemas'
import { HelpTip } from '../HelpTip'
import { TARIFF } from '../../lib/helpText'
import type {
  Driver,
  ElectricityProviderKind,
  ElectricityTariffConfig,
  EnergyYaml,
  GasProviderKind,
  GasTariffConfig,
  HeatSourceYaml,
  OctopusTestResponse,
} from '../../types/config'
import type { Fuel, ProviderKind, ProviderStatus } from '../../types/api'

interface TariffSettingsProps {
  energy: EnergyYaml
  heatSource?: HeatSourceYaml
  heatSources?: HeatSourceYaml[]
  driver: Driver
  onRefetch: () => void
}

const EDF_REGIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'] as const

// V3 150E-V2-M2: this map is DISPLAY FORMATTING — cosmetic capitalisation
// of backend-supplied Literal values for the rare null-tariff_label case
// (cold-start, FallbackProvider). It is NOT product knowledge — the
// authoritative product names come from the backend via tariff_label.
// A future T-27 audit reads this annotation and confirms the boundary.
const PROVIDER_KIND_DISPLAY: Record<ProviderKind, string> = {
  octopus_electricity: 'Octopus',
  octopus_gas: 'Octopus',
  edf_freephase: 'EDF FreePhase',
  fixed: 'Fixed',
  fallback: 'Not configured',
  ha_entity: 'Home Assistant',
}

// 158C: REDACTED sentinel — declared locally; no shared frontend constant
// exists. If one is introduced later (e.g. in lib/api.ts), import from there.
const REDACTED_SENTINEL = '***REDACTED***'

function stripSentinels<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    // Omit any field whose value still equals the sentinel — the user did
    // not modify it, and the backend (158A Task 3) will restore from the
    // existing real value (or fall back to the legacy bridge).
    if (v === REDACTED_SENTINEL) continue
    out[k] = v
  }
  return out as T
}

function hydrateElectricity(energy: EnergyYaml): ElectricityTariffConfig {
  if (energy.electricity) return energy.electricity
  // Full-Octopus credentials win first.
  if (energy.octopus?.api_key) {
    return {
      provider: 'octopus',
      octopus_api_key: energy.octopus.api_key,
      octopus_account_number: energy.octopus.account_number,
    }
  }
  // 158C: HA-brokered legacy. User has the Octopus Energy HACS integration
  // and energy.octopus.rates.current_day set. Mirrors the backend
  // _normalise_legacy_config branch in qsh/tariff/__init__.py.
  if (energy.octopus?.rates?.current_day) {
    return {
      provider: 'ha_entity',
      rates_entity: energy.octopus.rates.current_day,
    }
  }
  if (energy.fixed_rates?.import_rate != null) {
    return { provider: 'fixed', fixed_rate: energy.fixed_rates.import_rate }
  }
  return { provider: 'octopus' }
}

function hydrateGas(energy: EnergyYaml): GasTariffConfig {
  if (energy.gas) return energy.gas
  return { provider: 'fixed', fixed_rate: 0.07 }
}

function installHasFuel(
  heatSource: HeatSourceYaml | undefined,
  heatSources: HeatSourceYaml[] | undefined,
  fuel: 'gas' | 'lpg' | 'oil',
): boolean {
  const sources: HeatSourceYaml[] = []
  if (heatSource) sources.push(heatSource)
  if (heatSources) sources.push(...heatSources)
  const target = fuel === 'gas' ? 'gas_boiler' : fuel === 'lpg' ? 'lpg_boiler' : 'oil_boiler'
  return sources.some((hs) => hs.type === target)
}

export function TariffSettings({
  energy: initial,
  heatSource: initialHs,
  heatSources: initialHsList,
  driver,
  onRefetch,
}: TariffSettingsProps) {
  void driver
  const [energy, setEnergy] = useState<EnergyYaml>(initial)
  const [electricity, setElectricity] = useState<ElectricityTariffConfig>(() => hydrateElectricity(initial))
  const [gas, setGas] = useState<GasTariffConfig>(() => hydrateGas(initial))
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<OctopusTestResponse | null>(null)
  const [edfTesting, setEdfTesting] = useState(false)
  const [edfTestResult, setEdfTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const { patch, saving } = usePatchConfig()
  const { byFuel, edfFreephaseSupported } = useTariffStatus()

  const hasGas = installHasFuel(initialHs, initialHsList, 'gas')
  const hasLpg = installHasFuel(initialHs, initialHsList, 'lpg')
  const hasOil = installHasFuel(initialHs, initialHsList, 'oil')

  useEffect(() => {
    setEnergy(initial)
    setElectricity(hydrateElectricity(initial))
    setGas(hydrateGas(initial))
  }, [initial])

  const save = async () => {
    // 158C Task 4: strip REDACTED sentinels before transmit. The backend
    // (158A Task 3) restores the real value from the existing config or
    // the legacy bridge. Belt-and-braces: keeps the sentinel string out
    // of the wire payload entirely.
    const payload: EnergyYaml = {
      fallback_rates: energy.fallback_rates,
      electricity: stripSentinels(electricity),
      ...(hasGas ? { gas: stripSentinels(gas) } : {}),
      ...(hasLpg && energy.lpg ? { lpg: energy.lpg } : {}),
      ...(hasOil && energy.oil ? { oil: energy.oil } : {}),
    }
    const result = await patch('energy', payload)
    if (result) onRefetch()
  }

  const testOctopus = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const apiKey = electricity.octopus_api_key || gas.octopus_api_key || ''
      const accountNumber = electricity.octopus_account_number || gas.octopus_account_number || ''
      const resp = await fetch(apiUrl('api/wizard/test-octopus'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, account_number: accountNumber }),
      })
      if (!resp.ok) {
        const text = await resp.text()
        setTestResult({ success: false, message: `Server error ${resp.status}: ${text.slice(0, 120)}` })
        return
      }
      const data: OctopusTestResponse = await resp.json()
      setTestResult(data)
      if (data.success) {
        if (data.tariff_code) {
          setElectricity((prev) => ({ ...prev, octopus_tariff_code: data.tariff_code as string }))
        }
        if (hasGas && data.gas_tariff_code) {
          setGas((prev) => ({ ...prev, octopus_tariff_code: data.gas_tariff_code as string }))
        }
      }
    } catch (e) {
      setTestResult({ success: false, message: `Network error: ${e instanceof Error ? e.message : e}` })
    } finally {
      setTesting(false)
    }
  }

  const testEdfRegion = async (region: string) => {
    setEdfTesting(true)
    try {
      const r = await fetch(apiUrl('api/wizard/test-edf-region'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region }),
      })
      if (!r.ok) {
        const text = await r.text()
        setEdfTestResult({ success: false, message: `Server error ${r.status}: ${text.slice(0, 120)}` })
        return
      }
      const raw = await r.json()
      const parsed = testEdfRegionResponseSchema.safeParse(raw)
      if (!parsed.success) {
        setEdfTestResult({ success: false, message: 'Unexpected response format' })
        return
      }
      setEdfTestResult(parsed.data)
    } catch (e) {
      setEdfTestResult({
        success: false,
        message: `Network error: ${e instanceof Error ? e.message : e}`,
      })
    } finally {
      setEdfTesting(false)
    }
  }

  const setElectricityProvider = (provider: ElectricityProviderKind) => {
    setElectricity((prev) => ({ ...prev, provider }))
    setTestResult(null)
    setEdfTestResult(null)
  }

  const setGasProvider = (provider: GasProviderKind) => {
    setGas((prev) => ({ ...prev, provider }))
  }

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

      <section className="space-y-4" data-testid="settings-electricity">
        <h3 className="text-sm font-semibold text-[var(--text)]">Electricity</h3>
        <ProviderRadio
          name="electricity-provider"
          value={electricity.provider}
          onChange={(v) => setElectricityProvider(v as ElectricityProviderKind)}
          options={[
            { value: 'octopus', label: 'Octopus', desc: 'Agile, Tracker, Go, Cosy, Flux' },
            ...(edfFreephaseSupported
              ? [{ value: 'edf_freephase', label: 'EDF FreePhase Dynamic', desc: 'Region-determined dynamic tariff' }]
              : []),
            { value: 'ha_entity', label: 'Home Assistant', desc: 'Rates from an existing HA integration' },
            { value: 'fixed', label: 'Fixed Rate', desc: 'Single £/kWh' },
          ]}
        />

        {electricity.provider === 'octopus' && (
          <OctopusFields
            apiKey={electricity.octopus_api_key || ''}
            accountNumber={electricity.octopus_account_number || ''}
            onApiKey={(v) => setElectricity((prev) => ({ ...prev, octopus_api_key: v }))}
            onAccount={(v) => setElectricity((prev) => ({ ...prev, octopus_account_number: v }))}
            testing={testing}
            testResult={testResult}
            onTest={testOctopus}
          />
        )}

        {electricity.provider === 'edf_freephase' && (
          <EdfRegionPicker
            value={electricity.edf_region || ''}
            onChange={(v) => {
              setElectricity((prev) => ({ ...prev, edf_region: v }))
              if (v) void testEdfRegion(v)
            }}
            testing={edfTesting}
            result={edfTestResult}
          />
        )}

        {electricity.provider === 'ha_entity' && (
          <HAEntityRatesInput
            value={electricity.rates_entity || ''}
            valueNext={electricity.rates_entity_next || ''}
            onChange={(v) =>
              setElectricity((prev) => ({
                ...prev,
                rates_entity: v === '' ? undefined : v,
              }))
            }
            onChangeNext={(v) =>
              setElectricity((prev) => ({
                ...prev,
                rates_entity_next: v === '' ? undefined : v,
              }))
            }
          />
        )}

        {electricity.provider === 'fixed' && (
          <FixedRateInput
            label="Electricity Rate (£/kWh)"
            help={TARIFF.importRate}
            value={electricity.fixed_rate ?? 0.245}
            onChange={(v) => setElectricity((prev) => ({ ...prev, fixed_rate: v }))}
          />
        )}
      </section>

      {hasGas && (
        <section className="space-y-4" data-testid="settings-gas">
          <h3 className="text-sm font-semibold text-[var(--text)]">Gas</h3>
          <ProviderRadio
            name="gas-provider"
            value={gas.provider}
            onChange={(v) => setGasProvider(v as GasProviderKind)}
            options={[
              { value: 'octopus', label: 'Octopus Tracker', desc: 'Daily-tracking gas tariff' },
              { value: 'fixed', label: 'Fixed Rate', desc: 'Single £/kWh' },
            ]}
          />

          {gas.provider === 'octopus' && (
            <OctopusFields
              apiKey={gas.octopus_api_key || electricity.octopus_api_key || ''}
              accountNumber={gas.octopus_account_number || electricity.octopus_account_number || ''}
              onApiKey={(v) => setGas((prev) => ({ ...prev, octopus_api_key: v }))}
              onAccount={(v) => setGas((prev) => ({ ...prev, octopus_account_number: v }))}
              testing={testing}
              testResult={testResult}
              onTest={testOctopus}
              showGasCode
            />
          )}

          {gas.provider === 'fixed' && (
            <FixedRateInput
              label="Gas Rate (£/kWh)"
              value={gas.fixed_rate ?? 0.07}
              onChange={(v) => setGas((prev) => ({ ...prev, fixed_rate: v }))}
            />
          )}
        </section>
      )}

      {hasLpg && (
        <section className="space-y-4" data-testid="settings-lpg">
          <h3 className="text-sm font-semibold text-[var(--text)]">LPG</h3>
          <FixedRateInput
            label="LPG Rate (£/kWh)"
            value={(energy.lpg?.fixed_rate as number | undefined) ?? 0.10}
            onChange={(v) => setEnergy((prev) => ({ ...prev, lpg: { provider: 'fixed', fixed_rate: v } }))}
          />
        </section>
      )}

      {hasOil && (
        <section className="space-y-4" data-testid="settings-oil">
          <h3 className="text-sm font-semibold text-[var(--text)]">Oil</h3>
          <FixedRateInput
            label="Oil Rate (£/kWh)"
            value={(energy.oil?.fixed_rate as number | undefined) ?? 0.08}
            onChange={(v) => setEnergy((prev) => ({ ...prev, oil: { provider: 'fixed', fixed_rate: v } }))}
          />
        </section>
      )}

      {/* Provider Status panel — V5 C-2 / V2 E-M4: backend owns the display
          string via ProviderStatus.tariff_label. Frontend is a pass-through. */}
      <ProviderStatusPanel byFuel={byFuel} />

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
                  setEnergy((prev) => ({
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

// ───── Sub-components ─────

function ProviderStatusPanel({ byFuel }: { byFuel: Partial<Record<Fuel, ProviderStatus>> }) {
  const fuels = Object.keys(byFuel) as Fuel[]
  if (fuels.length === 0) {
    return (
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-sm text-[var(--text-muted)]">
        No live tariff data yet — providers haven't reported.
      </div>
    )
  }
  return (
    <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
      <h3 className="text-sm font-medium text-[var(--text)]">Provider Status</h3>
      <div className="space-y-2 text-sm" data-testid="provider-status-list">
        {fuels.sort().map((fuel) => {
          const s = byFuel[fuel]
          if (!s) return null
          const label = s.tariff_label ?? PROVIDER_KIND_DISPLAY[s.provider_kind]
          return (
            <div key={fuel} className="flex flex-col" data-testid={`provider-status-${fuel}`}>
              <div className="flex items-center gap-2">
                <span className="font-medium capitalize">{fuel}:</span>
                <span>{label}</span>
                <span className="text-[var(--text-muted)]">·</span>
                <span className="text-[var(--text-muted)] text-xs">
                  last refresh {formatTime(s.last_refresh_at)}
                </span>
                <span className="text-[var(--text-muted)]">·</span>
                <span className="text-[var(--text-muted)] text-xs">
                  last price {formatPrice(s.last_price)}
                </span>
                {s.stale && (
                  <span
                    data-testid={`stale-${fuel}`}
                    className="ml-2 inline-flex items-center gap-1 text-[var(--amber)] text-xs"
                  >
                    <AlertTriangle size={12} /> Stale
                  </span>
                )}
              </div>
              {s.last_error && (
                <div className="text-xs text-[var(--text-muted)] italic mt-0.5">
                  {s.last_error}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatTime(t: number | null): string {
  if (t == null) return '—'
  const d = new Date(t * 1000)
  return d.toLocaleTimeString()
}

function formatPrice(p: number): string {
  if (Number.isFinite(p)) return `£${p.toFixed(4)}/kWh`
  return '—'
}

interface ProviderRadioOption {
  value: string
  label: string
  desc: string
}

function ProviderRadio({
  name,
  value,
  onChange,
  options,
}: {
  name: string
  value: string
  onChange: (v: string) => void
  options: ProviderRadioOption[]
}) {
  return (
    <div role="radiogroup" aria-label={name} className={cn(
      'grid gap-3',
      options.length === 2 ? 'grid-cols-2' : 'grid-cols-3',
    )}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          data-testid={`provider-${name}-${opt.value}`}
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex flex-col items-center gap-1 p-3 rounded-lg border text-sm transition-colors',
            value === opt.value
              ? 'border-[var(--accent)] bg-[var(--accent)]/5'
              : 'border-[var(--border)] hover:border-[var(--accent)]/50',
          )}
        >
          <span className="font-medium">{opt.label}</span>
          <span className="text-xs text-[var(--text-muted)]">{opt.desc}</span>
        </button>
      ))}
    </div>
  )
}

function OctopusFields({
  apiKey,
  accountNumber,
  onApiKey,
  onAccount,
  testing,
  testResult,
  onTest,
  showGasCode,
}: {
  apiKey: string
  accountNumber: string
  onApiKey: (v: string) => void
  onAccount: (v: string) => void
  testing: boolean
  testResult: OctopusTestResponse | null
  onTest: () => void
  showGasCode?: boolean
}) {
  return (
    <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => onApiKey(e.target.value)}
            placeholder="sk_live_..."
            className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Account Number</label>
          <input
            type="text"
            value={accountNumber}
            onChange={(e) => onAccount(e.target.value)}
            placeholder="A-1234ABCD"
            className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onTest}
          disabled={testing || !apiKey || !accountNumber}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg)] disabled:opacity-50"
        >
          {testing && <Loader2 size={14} className="animate-spin" />}
          Test Connection
        </button>
        {testResult && (
          <div className={cn(
            'flex items-center gap-2 text-sm',
            testResult.success ? 'text-[var(--green)]' : 'text-[var(--red)]',
          )}>
            {testResult.success ? <Check size={14} /> : <X size={14} />}
            {testResult.message}
          </div>
        )}
      </div>
      {testResult?.success && testResult.tariff_code && (
        <div className="text-xs text-[var(--text-muted)] space-y-1">
          <div>Import: <span className="font-mono text-[var(--text)]">{testResult.tariff_code}</span></div>
          {showGasCode && testResult.gas_tariff_code && (
            <div>Gas: <span className="font-mono text-[var(--text)]">{testResult.gas_tariff_code}</span></div>
          )}
        </div>
      )}
    </div>
  )
}

function EdfRegionPicker({
  value,
  onChange,
  testing,
  result,
}: {
  value: string
  onChange: (v: string) => void
  testing: boolean
  result: { success: boolean; message: string } | null
}) {
  return (
    <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-2">
      <p className="text-xs text-[var(--text-muted)]">
        EDF FreePhase requires no API key — tariff is determined by your region letter.
      </p>
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-[var(--text)]">Region</label>
        <select
          aria-label="EDF region"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
        >
          <option value="">Select…</option>
          {EDF_REGIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        {testing && <Loader2 size={14} className="animate-spin text-[var(--text-muted)]" />}
        {!testing && result && result.success && (
          <span className="flex items-center gap-1 text-xs text-[var(--green)]">
            <Check size={14} /> Region available
          </span>
        )}
        {!testing && result && !result.success && (
          <span className="flex items-center gap-1 text-xs text-[var(--red)]">
            <X size={14} /> {result.message}
          </span>
        )}
      </div>
    </div>
  )
}

function HAEntityRatesInput({
  value,
  valueNext,
  onChange,
  onChangeNext,
}: {
  value: string
  valueNext: string
  onChange: (v: string) => void
  onChangeNext: (v: string) => void
}) {
  return (
    <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-2">
      <p className="text-xs text-[var(--text-muted)]">
        QSH will read tariff rates from these Home Assistant entities —
        typically the Octopus Energy HACS integration's current-day and
        next-day rate events. The next-day entity is optional but
        recommended for accurate evening planning.
      </p>
      <label className="block">
        <span className="block text-xs text-[var(--text-muted)] mb-1">Rates Entity</span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="event.octopus_energy_electricity_..._current_day_rates"
          spellCheck={false}
          className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm font-mono text-[var(--text)]"
        />
      </label>
      <label className="block">
        <span className="block text-xs text-[var(--text-muted)] mb-1">Next-day Rates Entity (optional)</span>
        <input
          type="text"
          value={valueNext}
          onChange={(e) => onChangeNext(e.target.value)}
          placeholder="event.octopus_energy_electricity_..._next_day_rates"
          spellCheck={false}
          className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm font-mono text-[var(--text)]"
        />
      </label>
    </div>
  )
}

function FixedRateInput({
  label,
  value,
  onChange,
  help,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  help?: string
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1 text-sm font-medium text-[var(--text)] mb-1">
        {label}
        {help && <HelpTip text={help} size={12} />}
      </span>
      <input
        type="number"
        step="0.001"
        min={0.01}
        max={2.0}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
      />
    </label>
  )
}
