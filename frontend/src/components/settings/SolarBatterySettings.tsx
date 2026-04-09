import { useState, useMemo } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { patchOrDelete } from '../../hooks/useConfig'
import { useEntityResolve } from '../../hooks/useEntityResolve'
import { EntityField } from './EntityField'
import { SOLAR } from '../../lib/helpText'
import type { SolarYaml, BatteryYaml, GridYaml, InverterYaml } from '../../types/config'

interface SolarBatterySettingsProps {
  solar?: SolarYaml
  battery?: BatteryYaml
  grid?: GridYaml
  inverter?: InverterYaml
  onRefetch: () => void
}

export function SolarBatterySettings({
  solar: initialSolar,
  battery: initialBattery,
  grid: initialGrid,
  inverter: initialInverter,
  onRefetch,
}: SolarBatterySettingsProps) {
  const [hasSolar, setHasSolar] = useState(!!initialSolar?.production_entity)
  const [hasBattery, setHasBattery] = useState(!!initialBattery?.soc_entity)

  const [solar, setSolar] = useState<SolarYaml>(initialSolar || {})
  const [battery, setBattery] = useState<BatteryYaml>(initialBattery || {})
  const [grid, setGrid] = useState<GridYaml>(initialGrid || {})
  const [inverter, setInverter] = useState<InverterYaml>(initialInverter || {})

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const entityIds = useMemo(
    () =>
      [solar.production_entity, battery.soc_entity, grid.power_entity].filter(
        Boolean
      ) as string[],
    [solar.production_entity, battery.soc_entity, grid.power_entity]
  )
  const { resolved } = useEntityResolve(entityIds)

  const save = async () => {
    setSaving(true)
    setError(null)

    const SECTION_NAMES = ['solar', 'battery', 'grid', 'inverter']
    const results = await Promise.allSettled([
      patchOrDelete('solar', hasSolar, solar),
      patchOrDelete('battery', hasBattery, battery),
      patchOrDelete('grid', hasBattery, grid),
      patchOrDelete('inverter', hasSolar, inverter),
    ])

    const failures = results
      .map((r, i) => (r.status === 'rejected' ? SECTION_NAMES[i] : null))
      .filter(Boolean)

    if (failures.length > 0) {
      setError(`Failed to save: ${failures.join(', ')}`)
    } else {
      onRefetch()
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">Solar & Battery</h2>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-[var(--red)]/10 text-[var(--red)] text-sm">
          {error}
        </div>
      )}

      {/* Solar */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hasSolar}
            onChange={(e) => setHasSolar(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          <span className="text-sm font-medium text-[var(--text)]">I have solar panels</span>
        </label>

        {hasSolar && (
          <div className="space-y-4 pl-4 border-l-2 border-[var(--border)]">
            <EntityField
              label="Solar Production Entity"
              value={solar.production_entity || ''}
              friendlyName={resolved[solar.production_entity || '']?.friendly_name}
              state={resolved[solar.production_entity || '']?.state}
              unit={resolved[solar.production_entity || '']?.unit}
              onChange={(v) => setSolar({ ...solar, production_entity: v || undefined })}
              placeholder="sensor.solar_power"
              helpText={SOLAR.solarEntity}
            />

            <div>
              <label className="block text-xs font-medium text-[var(--text)] mb-1">
                Inverter Fallback Efficiency (0.8–1.0)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.8"
                max="1.0"
                value={inverter.fallback_efficiency ?? 0.97}
                onChange={(e) =>
                  setInverter({ ...inverter, fallback_efficiency: parseFloat(e.target.value) || 0.97 })
                }
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
            </div>
          </div>
        )}
      </div>

      {/* Battery */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hasBattery}
            onChange={(e) => setHasBattery(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          <span className="text-sm font-medium text-[var(--text)]">I have a home battery</span>
        </label>

        {hasBattery && (
          <div className="space-y-4 pl-4 border-l-2 border-[var(--border)]">
            <EntityField
              label="Battery SoC Entity"
              value={battery.soc_entity || ''}
              friendlyName={resolved[battery.soc_entity || '']?.friendly_name}
              state={resolved[battery.soc_entity || '']?.state}
              unit={resolved[battery.soc_entity || '']?.unit}
              onChange={(v) => setBattery({ ...battery, soc_entity: v || undefined })}
              placeholder="sensor.battery_soc"
              helpText={SOLAR.batteryEntity}
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Min SoC Reserve (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={battery.min_soc_reserve ?? 10}
                  onChange={(e) =>
                    setBattery({ ...battery, min_soc_reserve: parseInt(e.target.value) || 10 })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Efficiency (0.5–1.0)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.5"
                  max="1.0"
                  value={battery.efficiency ?? 0.9}
                  onChange={(e) =>
                    setBattery({ ...battery, efficiency: parseFloat(e.target.value) || 0.9 })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Voltage (V)
                </label>
                <input
                  type="number"
                  min="40"
                  max="60"
                  value={battery.voltage ?? 51.2}
                  onChange={(e) =>
                    setBattery({ ...battery, voltage: parseFloat(e.target.value) || 51.2 })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Max Rate (kW)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="10"
                  value={battery.max_rate_kw ?? 3.0}
                  onChange={(e) =>
                    setBattery({ ...battery, max_rate_kw: parseFloat(e.target.value) || 3.0 })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
            </div>

            {/* Grid */}
            <h4 className="text-sm font-medium text-[var(--text)] mt-4">Grid</h4>
            <EntityField
              label="Grid Power Entity"
              value={grid.power_entity || ''}
              friendlyName={resolved[grid.power_entity || '']?.friendly_name}
              state={resolved[grid.power_entity || '']?.state}
              unit={resolved[grid.power_entity || '']?.unit}
              onChange={(v) => setGrid({ ...grid, power_entity: v || undefined })}
              placeholder="sensor.grid_power"
            />
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Nominal Voltage (V)
                </label>
                <input
                  type="number"
                  min="220"
                  max="250"
                  value={grid.nominal_voltage ?? 230}
                  onChange={(e) =>
                    setGrid({ ...grid, nominal_voltage: parseInt(e.target.value) || 230 })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Min Voltage (V)
                </label>
                <input
                  type="number"
                  min="190"
                  max="230"
                  value={grid.min_voltage ?? 207}
                  onChange={(e) =>
                    setGrid({ ...grid, min_voltage: parseInt(e.target.value) || 207 })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Max Voltage (V)
                </label>
                <input
                  type="number"
                  min="240"
                  max="260"
                  value={grid.max_voltage ?? 253}
                  onChange={(e) =>
                    setGrid({ ...grid, max_voltage: parseInt(e.target.value) || 253 })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
