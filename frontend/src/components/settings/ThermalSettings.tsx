// Driver-agnostic: this component exposes no HA entity IDs or MQTT topics. Audited INSTRUCTION-88D.
import { useState, useEffect } from 'react'
import { Save, Loader2, X } from 'lucide-react'
import { usePatchConfig } from '../../hooks/useConfig'
import type { ThermalYaml, ShoulderYaml, SummerYaml, Driver } from '../../types/config'

interface ThermalSettingsProps {
  thermal: ThermalYaml
  // INSTRUCTION-334 (P-3/P-4): the seasonal sections are surfaced here for
  // edit-after-setup parity with StepThermal. Optional so existing callers
  // (e.g. PropSync.test) that pre-date this change still type-check; absent
  // props default to {} INSIDE the body (never as a default parameter — a
  // fresh {} per render would churn the resync effect's identity dep).
  shoulder?: ShoulderYaml
  summer?: SummerYaml
  rooms: string[]
  driver: Driver
  onRefetch: () => void
}

// driver threaded in 88B; consumed in 88C/88D via rename to `driver`
export function ThermalSettings({
  thermal: initialThermal,
  shoulder: initialShoulder,
  summer: initialSummer,
  rooms,
  driver: _driver,
  onRefetch,
}: ThermalSettingsProps) {
  const [thermal, setThermal] = useState<ThermalYaml>(initialThermal)
  const [shoulder, setShoulder] = useState<ShoulderYaml>(initialShoulder ?? {})
  const [summer, setSummer] = useState<SummerYaml>(initialSummer ?? {})
  const [saveError, setSaveError] = useState<string | null>(null)
  const { patch, saving } = usePatchConfig()

  // Prop resync (mirrors the original thermal effect). For shoulder/summer
  // this is also the dual-write guard (§6 handoff-4): a SeasonalTuning write
  // to shoulder.hp_min_output_kw lands in the parent's refetched config and
  // is pulled back into local state here, so the next whole-section shoulder
  // PATCH carries the fresh value rather than a stale one.
  useEffect(() => { setThermal(initialThermal) }, [initialThermal])
  useEffect(() => { setShoulder(initialShoulder ?? {}) }, [initialShoulder])
  useEffect(() => { setSummer(initialSummer ?? {}) }, [initialSummer])

  const update = (changes: Partial<ThermalYaml>) => {
    setThermal(prev => ({ ...prev, ...changes }))
  }

  // Save-gate floors (M fix). An empty/NaN field is coerced to the default on
  // input (see the onChange handlers below), so state only ever holds a number
  // or undefined. forecast < 1 is meaningless (0-hour horizon); demand < 0 is
  // invalid — but demand === 0 is valid and meaningful (disables demand-
  // triggered summer entry, summer_controller.py gates `demand < threshold`).
  const forecast = shoulder.forecast_horizon_hours
  const demand = summer.demand_threshold_kw
  const forecastValid = forecast == null || (Number.isFinite(forecast) && forecast >= 1)
  const demandValid = demand == null || (Number.isFinite(demand) && demand >= 0)
  const canSave = forecastValid && demandValid

  // Dirty-gate each owned section against its initial prop — raw section
  // objects on both sides (like-with-like, no transform), so the structural
  // compare is sound. Whole-section writes preserve co-resident keys through
  // the backend's incoming-keys-only overwrite.
  const thermalDirty = JSON.stringify(thermal) !== JSON.stringify(initialThermal)
  const shoulderDirty = JSON.stringify(shoulder) !== JSON.stringify(initialShoulder ?? {})
  const summerDirty = JSON.stringify(summer) !== JSON.stringify(initialSummer ?? {})

  const save = async () => {
    setSaveError(null)
    // Serialized, ordered, dirty-gated, whole-section writes; abort on first
    // failure and withhold onRefetch so the UI keeps the unsaved edits rather
    // than diverging from a partial write (§1.1).
    const writes: Array<[string, object, boolean]> = [
      ['thermal', thermal, thermalDirty],
      ['shoulder', shoulder, shoulderDirty],
      ['summer', summer, summerDirty],
    ]
    for (const [section, payload, dirty] of writes) {
      if (!dirty) continue
      let ok = false
      try {
        ok = Boolean(await patch(section, payload))
      } catch {
        ok = false
      }
      if (!ok) {
        setSaveError(`Failed to save ${section} settings. Your changes have not been applied.`)
        return
      }
    }
    onRefetch()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">Thermal Properties</h2>
        <button
          onClick={save}
          disabled={saving || !canSave}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      {saveError && (
        <div
          role="alert"
          className="px-4 py-3 rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 text-sm text-[var(--text)]"
        >
          <div className="flex items-start gap-2">
            <span className="flex-1">{saveError}</span>
            <button
              type="button"
              onClick={() => setSaveError(null)}
              aria-label="Dismiss error"
              className="text-[var(--text-muted)] hover:text-[var(--text)] shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text)] mb-1">
              Peak Heat Loss (kW)
            </label>
            <input
              type="number"
              step="0.5"
              value={thermal.peak_loss_kw ?? ''}
              onChange={(e) => update({ peak_loss_kw: parseFloat(e.target.value) || undefined })}
              placeholder="5.0"
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text)] mb-1">
              Design External Temp
            </label>
            <input
              type="number"
              step="0.5"
              value={thermal.peak_external_temp ?? ''}
              onChange={(e) => update({ peak_external_temp: parseFloat(e.target.value) || undefined })}
              placeholder="-3.0"
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text)] mb-1">
              Thermal Mass (kWh/m2/K)
            </label>
            <input
              type="number"
              step="0.005"
              value={thermal.thermal_mass_per_m2 ?? ''}
              onChange={(e) => update({ thermal_mass_per_m2: parseFloat(e.target.value) || undefined })}
              placeholder="0.03"
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text)] mb-1">
              Heat-Up Tau (hours)
            </label>
            <input
              type="number"
              step="0.5"
              value={thermal.heat_up_tau_h ?? ''}
              onChange={(e) => update({ heat_up_tau_h: parseFloat(e.target.value) || undefined })}
              placeholder="1.0"
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--text)] mb-1">
            Overtemp Protection
          </label>
          <input
            type="number"
            step="0.5"
            value={thermal.overtemp_protection ?? ''}
            onChange={(e) => update({ overtemp_protection: parseFloat(e.target.value) || undefined })}
            placeholder="23.0"
            className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
        </div>

        {rooms.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-[var(--text)] mb-2">
              Persistent Zones
            </label>
            <div className="flex flex-wrap gap-2">
              {rooms.map((name) => {
                const isSelected = (thermal.persistent_zones || []).includes(name)
                return (
                  <button
                    key={name}
                    onClick={() => {
                      const current = thermal.persistent_zones || []
                      update({
                        persistent_zones: isSelected
                          ? current.filter((r) => r !== name)
                          : [...current, name],
                      })
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      isSelected
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                    }`}
                  >
                    {name.replace(/_/g, ' ')}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* INSTRUCTION-334 — seasonal fields, parity with StepThermal's Advanced
          section. Whole-section PATCH (shoulder / summer) preserves the
          co-resident keys (hp_min_output_kw, outdoor_temp_threshold_c, …). */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <h3 className="text-sm font-semibold text-[var(--text)]">Seasonal Modes</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="shoulder-forecast-horizon"
              className="block text-xs font-medium text-[var(--text)] mb-1"
            >
              Shoulder: Forecast Horizon (hours)
            </label>
            <input
              id="shoulder-forecast-horizon"
              type="number"
              min={1}
              step={1}
              value={shoulder.forecast_horizon_hours ?? 12}
              onChange={(e) => {
                // Explicit empty/NaN check — NOT `|| 12`, which would coerce a
                // typed 0 to 12 and hide an out-of-floor value from the gate.
                const raw = e.target.value
                const parsed = parseInt(raw, 10)
                const next = raw === '' || Number.isNaN(parsed) ? 12 : parsed
                setShoulder((prev) => ({ ...prev, forecast_horizon_hours: next }))
              }}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
            {!forecastValid && (
              <p className="mt-1 text-xs text-[var(--red)]">Must be at least 1 hour.</p>
            )}
          </div>
          <div>
            <label
              htmlFor="summer-demand-threshold"
              className="block text-xs font-medium text-[var(--text)] mb-1"
            >
              Summer: Demand Threshold (kW)
            </label>
            <input
              id="summer-demand-threshold"
              type="number"
              min={0}
              step={0.1}
              value={summer.demand_threshold_kw ?? 0.3}
              onChange={(e) => {
                // Explicit empty/NaN check — `|| 0.3` would rewrite the valid 0
                // (0 disables demand-triggered summer entry) to the default.
                const raw = e.target.value
                const parsed = parseFloat(raw)
                const next = raw === '' || Number.isNaN(parsed) ? 0.3 : parsed
                setSummer((prev) => ({ ...prev, demand_threshold_kw: next }))
              }}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
            {!demandValid && (
              <p className="mt-1 text-xs text-[var(--red)]">Cannot be negative.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
