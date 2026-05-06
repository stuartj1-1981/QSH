/**
 * INSTRUCTION-150E Task 3: Wizard tariff step — provider-aware rendering
 * per fuel.
 *
 * - Electricity: Octopus / EDF FreePhase / Fixed radio. EDF gated on
 *   `useTariffStatus().edfFreephaseSupported` (V5 E-M1: backend capability,
 *   NOT current configuration — fixes the V1 Catch-22).
 * - Gas (when install includes a gas boiler): Octopus Tracker / Fixed.
 * - LPG / Oil: Fixed only — direct number input, no radio.
 * - Octopus Test Connection populates BOTH electricity AND gas tariff codes
 *   when the account has both meter points.
 * - EDF region change debounces 500ms, then calls
 *   `POST /api/wizard/test-edf-region` (route owned by 150D). Failed test
 *   blocks wizard advance — wizard surfaces this via the test result.
 *
 * The wizard PATCHes the new per-fuel shape; the backend's migrate-on-save
 * (150C) handles legacy `energy.octopus` / `energy.fixed_rates` keys.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, Check, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { apiUrl } from '../../lib/api'
import { useTariffStatus } from '../../hooks/useTariffStatus'
import { testEdfRegionResponseSchema } from '../../types/schemas'
import type {
  ElectricityProviderKind,
  ElectricityTariffConfig,
  EnergyYaml,
  GasProviderKind,
  GasTariffConfig,
  HeatSourceYaml,
  OctopusTestResponse,
  QshConfigYaml,
} from '../../types/config'

interface StepTariffProps {
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

const EDF_REGIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'] as const
type EdfRegion = (typeof EDF_REGIONS)[number]
const EDF_DEBOUNCE_MS = 500

/** Detect whether the install topology includes a fuel-burning source for
 *  the given fuel. Reads both the singular `heat_source` and the multi-
 *  source `heat_sources` array — wizard sets one or the other depending on
 *  install. */
function installHasFuel(config: Partial<QshConfigYaml>, fuel: 'gas' | 'lpg' | 'oil'): boolean {
  const sources: HeatSourceYaml[] = []
  if (config.heat_source) sources.push(config.heat_source as HeatSourceYaml)
  if (config.heat_sources) sources.push(...(config.heat_sources as HeatSourceYaml[]))
  const target = fuel === 'gas' ? 'gas_boiler' : fuel === 'lpg' ? 'lpg_boiler' : 'oil_boiler'
  return sources.some((hs) => hs.type === target)
}

// 158C: REDACTED sentinel — declared locally; no shared frontend constant
// exists. If one is introduced later, import from there.
const REDACTED_SENTINEL = '***REDACTED***'

function stripSentinels<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === REDACTED_SENTINEL) continue
    out[k] = v
  }
  return out as T
}

/** Hydrate the electricity tariff state from the (possibly legacy-shaped)
 *  energy config. Migration-on-save lives in the backend; the wizard just
 *  tries the new key first, then falls back to interpreting the legacy
 *  shape. */
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
  // 158C: HA-brokered legacy. Mirrors backend _normalise_legacy_config.
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

export function StepTariff({ config, onUpdate }: StepTariffProps) {
  const energy: EnergyYaml = config.energy || {}
  const { edfFreephaseSupported } = useTariffStatus()

  const [electricity, setElectricity] = useState<ElectricityTariffConfig>(() => hydrateElectricity(energy))
  const [gas, setGas] = useState<GasTariffConfig>(() => hydrateGas(energy))
  const hasGas = installHasFuel(config, 'gas')
  const hasLpg = installHasFuel(config, 'lpg')
  const hasOil = installHasFuel(config, 'oil')

  const [testingElectricity, setTestingElectricity] = useState(false)
  const [testingGas, setTestingGas] = useState(false)
  const [testResultElectricity, setTestResultElectricity] = useState<OctopusTestResponse | null>(null)
  const [testResultGas, setTestResultGas] = useState<OctopusTestResponse | null>(null)
  const [edfTesting, setEdfTesting] = useState(false)
  const [edfTestResult, setEdfTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const edfDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = (next: { electricity?: ElectricityTariffConfig; gas?: GasTariffConfig }) => {
    // 158C Task 5: strip REDACTED sentinels before forwarding to onUpdate
    // so the wizard's in-memory copy does not carry the literal sentinel.
    // Backend deploy still runs restore_redacted; this keeps the wire-out
    // payload clean.
    const elec = (next.electricity ?? electricity) as ElectricityTariffConfig
    const g = (next.gas ?? gas) as GasTariffConfig
    const updated: EnergyYaml = {
      ...energy,
      electricity: stripSentinels(elec),
      ...(hasGas ? { gas: stripSentinels(g) } : {}),
    }
    onUpdate('energy', updated)
  }

  const updateElectricity = (changes: Partial<ElectricityTariffConfig>) => {
    const updated = { ...electricity, ...changes } as ElectricityTariffConfig
    setElectricity(updated)
    persist({ electricity: updated })
  }

  const updateGas = (changes: Partial<GasTariffConfig>) => {
    const updated = { ...gas, ...changes } as GasTariffConfig
    setGas(updated)
    persist({ gas: updated })
  }

  const setElectricityProvider = (provider: ElectricityProviderKind) => {
    const updated: ElectricityTariffConfig = { ...electricity, provider }
    setElectricity(updated)
    setTestResultElectricity(null)
    setEdfTestResult(null)
    persist({ electricity: updated })
  }

  const setGasProvider = (provider: GasProviderKind) => {
    const updated: GasTariffConfig = { ...gas, provider }
    setGas(updated)
    setTestResultGas(null)
    persist({ gas: updated })
  }

  const testOctopus = async (fuel: 'electricity' | 'gas') => {
    const setTesting = fuel === 'electricity' ? setTestingElectricity : setTestingGas
    const setResult = fuel === 'electricity' ? setTestResultElectricity : setTestResultGas
    setTesting(true)
    setResult(null)
    try {
      // V2 M1: per-fuel credential resolution as a PAIR. Never mix one
      // fuel's api_key with the other's account_number — that produces a
      // Frankenstein request that walks the wrong account or 401s. The
      // split-billing dual-source case (Defect 2) is exactly where pair
      // integrity matters. The originating fuel wins ONLY when its pair is
      // complete; otherwise the other fuel's complete pair is used;
      // otherwise empty.
      const ownKey = fuel === 'electricity' ? electricity.octopus_api_key : gas.octopus_api_key
      const otherKey = fuel === 'electricity' ? gas.octopus_api_key : electricity.octopus_api_key
      const ownAcct = fuel === 'electricity' ? electricity.octopus_account_number : gas.octopus_account_number
      const otherAcct = fuel === 'electricity' ? gas.octopus_account_number : electricity.octopus_account_number
      const useOwn = Boolean(ownKey && ownAcct)
      const apiKey = useOwn ? (ownKey as string) : (otherKey || '')
      const accountNumber = useOwn ? (ownAcct as string) : (otherAcct || '')
      const resp = await fetch(apiUrl('api/wizard/test-octopus'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, account_number: accountNumber }),
      })
      if (!resp.ok) {
        const text = await resp.text()
        setResult({ success: false, message: `Server error ${resp.status}: ${text.slice(0, 120)}` })
        return
      }
      const data: OctopusTestResponse = await resp.json()
      setResult(data)

      // Per-fuel persistence — independent of data.success. The shared
      // account walk (wizard.py V2 C-M2) returns both tariff codes from
      // one round-trip when present; we write each one only if discovered.
      const elecPatch: Partial<ElectricityTariffConfig> = {}
      if (data.tariff_code) elecPatch.octopus_tariff_code = data.tariff_code
      const gasPatch: Partial<GasTariffConfig> = {}
      if (data.gas_tariff_code) gasPatch.octopus_tariff_code = data.gas_tariff_code

      let nextElec = electricity
      let nextGas = gas
      if (Object.keys(elecPatch).length > 0) {
        nextElec = { ...electricity, ...elecPatch }
        setElectricity(nextElec)
      }
      if (hasGas && Object.keys(gasPatch).length > 0) {
        nextGas = { ...gas, ...gasPatch, provider: gas.provider }
        setGas(nextGas)
      }
      if (nextElec !== electricity || nextGas !== gas) {
        persist({ electricity: nextElec, gas: nextGas })
      }
    } catch (e) {
      setResult({ success: false, message: `Network error: ${e instanceof Error ? e.message : e}` })
    } finally {
      setTesting(false)
    }
  }

  const testEdfRegion = async (region: EdfRegion) => {
    setEdfTesting(true)
    try {
      const r = await fetch(apiUrl('api/wizard/test-edf-region'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region }),
      })
      if (!r.ok) {
        const text = await r.text()
        setEdfTestResult({
          success: false,
          message: `Server error ${r.status}: ${text.slice(0, 120)}`,
        })
        return
      }
      const raw = await r.json()
      const parsed = testEdfRegionResponseSchema.safeParse(raw)
      if (!parsed.success) {
        console.warn('test-edf-region returned malformed JSON', parsed.error)
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

  const onEdfRegionChange = (region: string) => {
    updateElectricity({ edf_region: region })
    setEdfTestResult(null)
    if (edfDebounceRef.current) clearTimeout(edfDebounceRef.current)
    if (!region) return
    edfDebounceRef.current = setTimeout(() => {
      void testEdfRegion(region as EdfRegion)
    }, EDF_DEBOUNCE_MS)
  }

  useEffect(() => {
    return () => {
      if (edfDebounceRef.current) clearTimeout(edfDebounceRef.current)
    }
  }, [])

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">Energy Tariff</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Configure your energy tariff for cost-aware heating optimisation.
        </p>
      </div>

      {/* ───── Electricity ───── */}
      <section className="space-y-4" data-testid="tariff-electricity-section">
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
            onApiKey={(v) => updateElectricity({ octopus_api_key: v })}
            onAccount={(v) => updateElectricity({ octopus_account_number: v })}
            testing={testingElectricity}
            testResult={testResultElectricity}
            onTest={() => testOctopus('electricity')}
          />
        )}

        {electricity.provider === 'edf_freephase' && (
          <EdfRegionPicker
            value={electricity.edf_region || ''}
            onChange={onEdfRegionChange}
            testing={edfTesting}
            result={edfTestResult}
          />
        )}

        {electricity.provider === 'ha_entity' && (
          <HAEntityRatesInput
            value={electricity.rates_entity || ''}
            valueNext={electricity.rates_entity_next || ''}
            onChange={(v) => updateElectricity({ rates_entity: v === '' ? undefined : v })}
            onChangeNext={(v) => updateElectricity({ rates_entity_next: v === '' ? undefined : v })}
          />
        )}

        {electricity.provider === 'fixed' && (
          <FixedRateInput
            label="Electricity Rate (£/kWh)"
            value={electricity.fixed_rate ?? 0.245}
            onChange={(v) => updateElectricity({ fixed_rate: v })}
          />
        )}
      </section>

      {/* ───── Gas (boiler installs only) ───── */}
      {hasGas && (
        <section className="space-y-4" data-testid="tariff-gas-section">
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
              onApiKey={(v) => updateGas({ octopus_api_key: v })}
              onAccount={(v) => updateGas({ octopus_account_number: v })}
              testing={testingGas}
              testResult={testResultGas}
              onTest={() => testOctopus('gas')}
              showGasCode
            />
          )}

          {gas.provider === 'fixed' && (
            <FixedRateInput
              label="Gas Rate (£/kWh)"
              value={gas.fixed_rate ?? 0.07}
              onChange={(v) => updateGas({ fixed_rate: v })}
            />
          )}
        </section>
      )}

      {hasLpg && (
        <section className="space-y-4" data-testid="tariff-lpg-section">
          <h3 className="text-sm font-semibold text-[var(--text)]">LPG</h3>
          <FixedRateInput
            label="LPG Rate (£/kWh)"
            value={(energy.lpg?.fixed_rate as number | undefined) ?? 0.10}
            onChange={(v) =>
              onUpdate('energy', { ...energy, lpg: { provider: 'fixed', fixed_rate: v } })
            }
          />
        </section>
      )}

      {hasOil && (
        <section className="space-y-4" data-testid="tariff-oil-section">
          <h3 className="text-sm font-semibold text-[var(--text)]">Oil</h3>
          <FixedRateInput
            label="Oil Rate (£/kWh)"
            value={(energy.oil?.fixed_rate as number | undefined) ?? 0.08}
            onChange={(v) =>
              onUpdate('energy', { ...energy, oil: { provider: 'fixed', fixed_rate: v } })
            }
          />
        </section>
      )}

      {/* Fallback rates (always present — used if any provider goes stale) */}
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
                  onUpdate('energy', {
                    ...energy,
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

// ───── Sub-components ─────

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
            'flex flex-col items-center gap-1 p-4 rounded-lg border text-sm transition-colors',
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
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[var(--text)] mb-1">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => onApiKey(e.target.value)}
          placeholder="sk_live_..."
          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-[var(--text)] mb-1">Account Number</label>
        <input
          type="text"
          value={accountNumber}
          onChange={(e) => onAccount(e.target.value)}
          placeholder="A-1234ABCD"
          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
        />
      </div>

      <button
        type="button"
        onClick={onTest}
        disabled={testing || !apiKey || !accountNumber}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg)] disabled:opacity-50"
      >
        {testing && <Loader2 size={14} className="animate-spin" />}
        Test Connection
      </button>

      {testResult && (() => {
        const tickOnGas = showGasCode
          ? Boolean(testResult.gas_tariff_code)
          : Boolean(testResult.tariff_code)
        // V2 H1: gas card never displays electricity wording. When
        // tariff_code is truthy but gas_tariff_code is null, the account
        // walk found electricity and proves the gas meter is absent —
        // this is gas-side information, not an electricity success.
        const banner = showGasCode
          ? (testResult.gas_tariff_code
              ? `Connected. Gas tariff: ${testResult.gas_tariff_code}`
              : (testResult.tariff_code
                  ? 'No gas tariff discovered on this account'
                  : (testResult.message || 'Test failed')))
          : testResult.message
        return (
          <div className="space-y-2">
            <div
              className={cn(
                'flex items-center gap-2 p-3 rounded-lg text-sm',
                tickOnGas
                  ? 'bg-[var(--green)]/10 text-[var(--green)]'
                  : 'bg-[var(--red)]/10 text-[var(--red)]',
              )}
            >
              {tickOnGas ? <Check size={16} /> : <X size={16} />}
              <span>{banner}</span>
            </div>

            {/* Electricity-side metadata: export tariff (informational) and
                additional-import-tariff warning. Suppressed in the gas card
                (V2 H1: gas card never leaks electricity wording). */}
            {!showGasCode && testResult.export_tariff && (
              <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-[var(--text-muted)]">
                    Export tariff (informational — QSH does not optimise export)
                  </span>
                  <span className="font-mono text-xs text-[var(--text-muted)]">
                    {testResult.export_tariff}
                  </span>
                </div>
              </div>
            )}

            {!showGasCode
              && testResult.additional_import_tariffs
              && testResult.additional_import_tariffs.length > 0 && (
              <p className="text-xs text-[var(--amber)]">
                Multiple import tariffs detected (e.g., Economy 7 day/night).
                {' '}Using primary: <span className="font-mono">{testResult.tariff_code}</span>.
                {' '}Additional:{' '}
                <span className="font-mono">
                  {testResult.additional_import_tariffs.join(', ')}
                </span>
                . If this is incorrect, select the correct tariff manually.
              </p>
            )}

            {!showGasCode && !testResult.success && testResult.export_tariff && (
              <div className="p-3 rounded-lg bg-[var(--amber)]/10 border border-[var(--amber)]/30 text-sm text-[var(--amber)]">
                Only an export (Outgoing) tariff was found for this account:{' '}
                <span className="font-mono">{testResult.export_tariff}</span>.
                {' '}QSH optimises import cost. To use QSH, add your import
                tariff agreement in the Octopus dashboard and retry.
              </div>
            )}
          </div>
        )
      })()}
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
    <div className="space-y-2">
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
    <div className="space-y-2">
      <p className="text-xs text-[var(--text-muted)]">
        QSH will read tariff rates from these Home Assistant entities —
        typically the Octopus Energy HACS integration's current-day and
        next-day rate events. The next-day entity is optional but
        recommended for accurate evening planning.
      </p>
      <label className="block">
        <span className="block text-sm font-medium text-[var(--text)] mb-1">Rates Entity</span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="event.octopus_energy_electricity_..._current_day_rates"
          spellCheck={false}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm font-mono text-[var(--text)]"
        />
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-[var(--text)] mb-1">Next-day Rates Entity (optional)</span>
        <input
          type="text"
          value={valueNext}
          onChange={(e) => onChangeNext(e.target.value)}
          placeholder="event.octopus_energy_electricity_..._next_day_rates"
          spellCheck={false}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm font-mono text-[var(--text)]"
        />
      </label>
    </div>
  )
}

function FixedRateInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-[var(--text)] mb-1">{label}</span>
      <input
        type="number"
        step="0.001"
        min={0.01}
        max={2.0}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
      />
    </label>
  )
}
