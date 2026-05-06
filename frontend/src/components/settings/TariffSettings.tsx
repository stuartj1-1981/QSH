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
import { useLive } from '../../hooks/useLive'
import { DEFAULT_TARIFF_AGGRESSION_MODE } from '../../lib/tariff'
import type {
  Driver,
  ElectricityProviderKind,
  ElectricityTariffConfig,
  EnergyYaml,
  GasProviderKind,
  GasTariffConfig,
  HeatSourceYaml,
  OctopusTestResponse,
  PersistOctopusTariffCodesResponse,
  TariffAggressionMode,
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
  const [testingElectricity, setTestingElectricity] = useState(false)
  const [testingGas, setTestingGas] = useState(false)
  // INSTRUCTION-174: phase flag for the auto-persist call after a successful
  // Test Connection. Future polish (a distinct spinner) can read it; today
  // the test result message text reflects the phase. Setter-only — getter
  // intentionally elided to avoid an unused-locals warning.
  const [, setAutoPersisting] = useState(false)
  const [testResultElectricity, setTestResultElectricity] = useState<OctopusTestResponse | null>(null)
  const [testResultGas, setTestResultGas] = useState<OctopusTestResponse | null>(null)
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
      // account walk (wizard.py V2 C-M2) returns both tariff codes from one
      // round-trip when present; we write each one only if discovered.
      if (data.tariff_code) {
        setElectricity((prev) => ({ ...prev, octopus_tariff_code: data.tariff_code as string }))
      }
      if (hasGas && data.gas_tariff_code) {
        setGas((prev) => ({ ...prev, octopus_tariff_code: data.gas_tariff_code as string }))
      }
      // INSTRUCTION-174: Auto-persist discovered tariff codes immediately so
      // the user does not have to remember a second click. Surgical endpoint
      // touches only octopus_tariff_code; the form's other in-progress edits
      // stay in local state until Save Changes.
      //
      // V2 DESIGN gate: forward a code only when the corresponding fuel's
      // provider is "octopus" — defence-in-depth alongside the backend gate.
      // Mixed-provider households (Octopus elec + non-Octopus gas, or
      // vice-versa) get both codes back from test-octopus's single account
      // walk; only the Octopus-fuel code may be persisted.
      const elecCode = (electricity.provider === 'octopus' ? data.tariff_code : null) ?? null
      const gasCode = (hasGas && gas.provider === 'octopus' ? data.gas_tariff_code : null) ?? null
      if (elecCode || gasCode) {
        setAutoPersisting(true)
        try {
          const persistResp = await fetch(apiUrl('api/wizard/persist-octopus-tariff-codes'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              electricity_tariff_code: elecCode,
              gas_tariff_code: gasCode,
            }),
          })
          if (!persistResp.ok) {
            // V2 LOW: do not echo raw error body to UI — risks leaking server
            // internals (paths, stack fragments). Extract structured `detail`
            // when the response is JSON; otherwise show a fixed string and
            // direct the user to the server log.
            let detail = 'auto-persist failed — see server log'
            try {
              const errBody = await persistResp.json()
              if (errBody && typeof errBody.detail === 'string' && errBody.detail.length <= 200) {
                detail = `auto-persist failed: ${errBody.detail}`
              }
            } catch {
              // non-JSON body — keep the fixed string
            }
            // Augment but do not overwrite — the credential test itself succeeded.
            setResult({ ...data, message: `${data.message} · ${detail}` })
          } else {
            const persistData = (await persistResp.json()) as PersistOctopusTariffCodesResponse
            const anyPersisted = persistData.persisted.electricity || persistData.persisted.gas
            if (persistData.restart_required) {
              setResult({ ...data, message: `${data.message} · pipeline restarting` })
            } else if (anyPersisted) {
              // V2 MEDIUM: persist succeeded but restart flag write failed —
              // surface this so the user knows changes won't take effect
              // until manual restart.
              setResult({ ...data, message: `${data.message} · ${persistData.message}` })
            }
            // else: nothing persisted (e.g. provider was non-Octopus on
            // backend gate, or fuel block missing) — leave message untouched.
          }
        } catch (e) {
          setResult({ ...data, message: `${data.message} · auto-persist failed — see server log` })
          // Network-error detail goes to the console for engineering, not the UI.
          console.error('persist-octopus-tariff-codes network error:', e)
        } finally {
          setAutoPersisting(false)
        }
      }
    } catch (e) {
      setResult({ success: false, message: `Network error: ${e instanceof Error ? e.message : e}` })
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
    setTestResultElectricity(null)
    setEdfTestResult(null)
  }

  const setGasProvider = (provider: GasProviderKind) => {
    setGas((prev) => ({ ...prev, provider }))
    setTestResultGas(null)
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
            testing={testingElectricity}
            testResult={testResultElectricity}
            onTest={() => testOctopus('electricity')}
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

      {/* INSTRUCTION-163: Tariff Aggression slider — configuration UI must
          always be settable. The runtime-state gate that previously hid this
          section in summer monitoring has been moved to the Home-page
          operational display (TariffAggressionStatus). In summer the section
          renders disabled with an explanatory caption. */}
      <TariffAggressionSection
        value={
          (energy.tariff_aggression_mode as TariffAggressionMode | undefined) ??
          DEFAULT_TARIFF_AGGRESSION_MODE
        }
        onChange={(mode) => {
          // Save eagerly via patch — same `usePatchConfig` path as the rest
          // of the section. Local state mirrors the optimistic update.
          setEnergy((prev) => ({ ...prev, tariff_aggression_mode: mode }))
          void patch('energy', { tariff_aggression_mode: mode })
        }}
      />

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

// INSTRUCTION-136A Task 6: three-way Comfort/Optimise/Aggressive selector.
// Hidden in summer mode (per V2 plan). Saves via the parent's usePatchConfig
// path through onChange.
const TARIFF_AGGRESSION_OPTIONS: {
  value: TariffAggressionMode
  label: string
  desc: string
}[] = [
  {
    value: 'comfort',
    label: 'Comfort',
    desc: 'Never reduce flow temp for cost — comfort is paramount.',
  },
  {
    value: 'optimise',
    label: 'Optimise',
    desc: 'Drop flow temp when net savings exceed 10% of period cost.',
  },
  {
    value: 'aggressive',
    label: 'Aggressive',
    desc: 'Drop flow temp on any positive net savings — minor comfort dips OK.',
  },
]

function TariffAggressionSection({
  value,
  onChange,
}: {
  value: TariffAggressionMode
  onChange: (mode: TariffAggressionMode) => void
}) {
  // INSTRUCTION-163: configuration UI is never gated on operational state.
  // In summer monitoring the section renders disabled with a caption; the
  // runtime-state gate lives on the Home page (TariffAggressionStatus).
  const { data } = useLive()
  const summerActive = Boolean(
    data && data.type === 'cycle' && data.engineering?.summer_monitoring,
  )
  return (
    <div
      className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3"
      data-testid="tariff-aggression-section"
    >
      <h3 className="text-sm font-medium text-[var(--text)]">Tariff Aggression</h3>
      <p className="text-xs text-[var(--text-muted)]">
        Controls how aggressively QSH drops flow temperature during peak tariff slots.
      </p>
      {summerActive && (
        <p
          className="text-xs text-[var(--amber)]"
          data-testid="tariff-aggression-summer-note"
        >
          System is currently in summer monitoring — selection takes effect at the next heating season.
        </p>
      )}
      <div
        role="radiogroup"
        aria-label="tariff-aggression"
        aria-disabled={summerActive}
        className="grid grid-cols-3 gap-3"
      >
        {TARIFF_AGGRESSION_OPTIONS.map((opt) => {
          const selected = value === opt.value
          return (
            <button
              key={opt.value}
              role="radio"
              aria-checked={selected}
              aria-disabled={summerActive}
              disabled={summerActive}
              onClick={() => onChange(opt.value)}
              data-testid={`tariff-aggression-${opt.value}`}
              className={cn(
                'p-3 rounded-lg border text-left transition-colors',
                selected
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)]/60',
                'disabled:opacity-60 disabled:cursor-not-allowed',
              )}
            >
              <div className="text-sm font-medium text-[var(--text)]">{opt.label}</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">{opt.desc}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

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
            <div className={cn(
              'flex items-center gap-2 text-sm',
              tickOnGas ? 'text-[var(--green)]' : 'text-[var(--red)]',
            )}>
              {tickOnGas ? <Check size={14} /> : <X size={14} />}
              {banner}
            </div>
          )
        })()}
      </div>
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
