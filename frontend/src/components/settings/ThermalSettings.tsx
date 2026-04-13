// Driver-agnostic: this component exposes no HA entity IDs or MQTT topics. Audited INSTRUCTION-88D.
import { useState, useEffect } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { usePatchConfig } from '../../hooks/useConfig'
import type { ThermalYaml, Driver } from '../../types/config'

interface ThermalSettingsProps {
  thermal: ThermalYaml
  rooms: string[]
  driver: Driver
  onRefetch: () => void
}

// driver threaded in 88B; consumed in 88C/88D via rename to `driver`
export function ThermalSettings({ thermal: initial, rooms, driver: _driver, onRefetch }: ThermalSettingsProps) {
  const [thermal, setThermal] = useState<ThermalYaml>(initial)
  const { patch, saving } = usePatchConfig()

  useEffect(() => { setThermal(initial) }, [initial])

  const update = (changes: Partial<ThermalYaml>) => {
    setThermal(prev => ({ ...prev, ...changes }))
  }

  const save = async () => {
    const result = await patch('thermal', thermal)
    if (result) onRefetch()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">Thermal Properties</h2>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

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
    </div>
  )
}
