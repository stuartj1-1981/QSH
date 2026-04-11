import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ThermalYaml, QshConfigYaml } from '../../types/config'

interface StepThermalProps {
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

export function StepThermal({ config, onUpdate }: StepThermalProps) {
  const thermal: ThermalYaml = config.thermal || {}
  const rooms = config.rooms || {}
  const roomNames = Object.keys(rooms)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const update = (changes: Partial<ThermalYaml>) => {
    onUpdate('thermal', { ...thermal, ...changes })
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">
          Thermal Properties
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          These help QSH model your building's thermal behaviour. Defaults work well
          for most UK homes.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-1">
            Peak Heat Loss (kW)
          </label>
          <input
            type="number"
            step="0.5"
            value={thermal.peak_loss_kw ?? 5.0}
            onChange={(e) =>
              update({ peak_loss_kw: parseFloat(e.target.value) || 5.0 })
            }
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Small flat ~2kW, mid-terrace ~4kW, large detached ~10-12kW
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-1">
            Design External Temp
          </label>
          <input
            type="number"
            step="0.5"
            value={thermal.peak_external_temp ?? -3.0}
            onChange={(e) =>
              update({ peak_external_temp: parseFloat(e.target.value) || -3.0 })
            }
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            UK typical: -3 to -5. Scotland/N.England: -5 to -7
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-1">
            Thermal Mass (kWh/m\u00b2/K)
          </label>
          <input
            type="number"
            step="0.005"
            value={thermal.thermal_mass_per_m2 ?? 0.03}
            onChange={(e) =>
              update({ thermal_mass_per_m2: parseFloat(e.target.value) || 0.03 })
            }
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Timber: 0.02, Brick: 0.03, Stone: 0.05
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-1">
            Heat-Up Time Constant (hours)
          </label>
          <input
            type="number"
            step="0.5"
            value={thermal.heat_up_tau_h ?? 1.0}
            onChange={(e) =>
              update({ heat_up_tau_h: parseFloat(e.target.value) || 1.0 })
            }
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Fallback for rooms without a declared emitter type. Per-room emitter type (set in room config) overrides this automatically. Radiators: 1.0, Underfloor: 3-4.
          </p>
        </div>
      </div>

      {/* Persistent zones */}
      {roomNames.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-2">
            Persistent Zones
          </label>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Rooms that should never fully cool down (e.g. living spaces with stone floors).
          </p>
          <div className="flex flex-wrap gap-2">
            {roomNames.map((name) => {
              const isSelected = (thermal.persistent_zones || []).includes(name)
              return (
                <button
                  key={name}
                  onClick={() => {
                    const current = thermal.persistent_zones || []
                    const next = isSelected
                      ? current.filter((r) => r !== name)
                      : [...current, name]
                    update({ persistent_zones: next })
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)] hover:border-[var(--accent)]/50'
                  }`}
                >
                  {name.replace(/_/g, ' ')}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-[var(--text)] mb-1">
          Overtemp Protection
        </label>
        <input
          type="number"
          step="0.5"
          value={thermal.overtemp_protection ?? 23.0}
          onChange={(e) =>
            update({ overtemp_protection: parseFloat(e.target.value) || 23.0 })
          }
          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
        />
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Temperature at which heating is suppressed. Typical: 22-25
        </p>
      </div>

      {/* Advanced section */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        Advanced Settings
      </button>

      {showAdvanced && (
        <div className="space-y-4 pl-4 border-l-2 border-[var(--border)]">
          <p className="text-xs text-[var(--text-muted)]">
            Shoulder and summer mode settings. Defaults are good for most UK installations.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text)] mb-1">
                Shoulder: Forecast Horizon (hours)
              </label>
              <input
                type="number"
                value={config.shoulder?.forecast_horizon_hours ?? 12}
                onChange={(e) =>
                  onUpdate('shoulder', {
                    ...(config.shoulder || {}),
                    forecast_horizon_hours: parseInt(e.target.value) || 12,
                  })
                }
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text)] mb-1">
                Summer: Demand Threshold (kW)
              </label>
              <input
                type="number"
                step="0.1"
                value={config.summer?.demand_threshold_kw ?? 0.3}
                onChange={(e) =>
                  onUpdate('summer', {
                    ...(config.summer || {}),
                    demand_threshold_kw: parseFloat(e.target.value) || 0.3,
                  })
                }
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
