import { useState } from 'react'
import { EntityPicker } from './EntityPicker'
import { TopicPicker } from './TopicPicker'
import { useEntityScan } from '../../hooks/useEntityScan'
import type { HwPlanType, HwScheduleYaml, HwTankYaml, HwPrechargeYaml, QshConfigYaml } from '../../types/config'

type ProbeConfig = 'none' | 'single' | 'dual'

function deriveProbeConfig(tank: HwTankYaml): ProbeConfig {
  if (tank.sensor_top && tank.sensor_bottom) return 'dual'
  if (tank.sensor_top || tank.sensor_bottom) return 'single'
  return 'none'
}

interface StepHotWaterProps {
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

const CYLINDER_PLANS: { value: HwPlanType; label: string; desc: string }[] = [
  { value: 'W', label: 'W-plan', desc: 'Heating OR hot water — full interrupt' },
  { value: 'Y', label: 'Y-plan', desc: 'Simultaneous heating + HW possible' },
  { value: 'S', label: 'S-plan', desc: 'Separate zone valves' },
  { value: 'S+', label: 'S+ plan', desc: 'Priority cylinder valve' },
  { value: 'C', label: 'C-plan', desc: 'Combination boiler with cylinder' },
]

export function StepHotWater({ config, onUpdate }: StepHotWaterProps) {
  const { candidates } = useEntityScan()
  const isMqtt = config.driver === 'mqtt'

  const hasCylinder = config.hw_plan !== undefined && config.hw_plan !== 'Combi'
  const [enabled, setEnabled] = useState(hasCylinder)
  const [probeConfig, setProbeConfig] = useState<ProbeConfig>(
    deriveProbeConfig((config.hw_tank as HwTankYaml) || {})
  )

  const hwPlan = config.hw_plan ?? 'W'
  const hwSchedule: HwScheduleYaml = config.hw_schedule || {}
  const hwTank: HwTankYaml = config.hw_tank || {}
  const hwPrecharge: HwPrechargeYaml = config.hw_precharge || {}

  const toggle = (on: boolean) => {
    setEnabled(on)
    if (!on) {
      // Combi / no cylinder path — set hw_plan to Combi, omit all others
      onUpdate('hw_plan', 'Combi')
      onUpdate('hw_schedule', undefined)
      onUpdate('hw_tank', undefined)
      onUpdate('hw_precharge', undefined)
    } else {
      // Default to W-plan when enabling
      if (!config.hw_plan || config.hw_plan === 'Combi') {
        onUpdate('hw_plan', 'W')
      }
      if (!config.hw_schedule) {
        onUpdate('hw_schedule', { source: 'fixed', fixed_start_time: '02:30' })
      }
      if (!config.hw_tank) {
        onUpdate('hw_tank', { volume_litres: 200, target_temperature: 50 })
      }
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">Hot Water</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Configure domestic hot water (DHW) awareness so QSH can coordinate heating and hot water.
        </p>
      </div>

      {/* Gate question */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-[var(--text)]">
          Do you have a hot water cylinder?
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => toggle(true)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              enabled
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
            }`}
          >
            Yes
          </button>
          <button
            onClick={() => toggle(false)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              !enabled
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
            }`}
          >
            No (Combi / instant)
          </button>
        </div>
      </div>

      {!enabled && (
        <p className="text-sm text-[var(--text-muted)]">
          No cylinder — QSH will skip DHW scheduling. You can change this later in Settings.
        </p>
      )}

      {enabled && (
        <div className="space-y-6">
          {/* Plumbing Plan */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-[var(--text)]">Plumbing Plan</h3>
            <div className="grid grid-cols-1 gap-2">
              {CYLINDER_PLANS.map(({ value, label, desc }) => (
                <label
                  key={value}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                    hwPlan === value
                      ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                      : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="hw_plan"
                    value={value}
                    checked={hwPlan === value}
                    onChange={() => onUpdate('hw_plan', value)}
                    className="accent-[var(--accent)]"
                  />
                  <div>
                    <span className="text-sm font-medium text-[var(--text)]">{label}</span>
                    <span className="text-xs text-[var(--text-muted)] ml-2">{desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Schedule Source */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-[var(--text)]">Schedule Source</h3>
            {isMqtt ? (
              <p className="text-sm text-[var(--text-muted)]">Fixed time schedule (MQTT mode)</p>
            ) : (
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="hw_schedule_source"
                    value="entity"
                    checked={hwSchedule.source === 'entity'}
                    onChange={() =>
                      onUpdate('hw_schedule', { ...hwSchedule, source: 'entity' })
                    }
                    className="accent-[var(--accent)]"
                  />
                  <span className="text-sm text-[var(--text)]">HA entity</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="hw_schedule_source"
                    value="fixed"
                    checked={(hwSchedule.source || 'fixed') === 'fixed'}
                    onChange={() =>
                      onUpdate('hw_schedule', { ...hwSchedule, source: 'fixed' })
                    }
                    className="accent-[var(--accent)]"
                  />
                  <span className="text-sm text-[var(--text)]">Fixed time</span>
                </label>
              </div>
            )}

            {hwSchedule.source === 'entity' && (
              <div className="space-y-3 pl-4 border-l-2 border-[var(--border)]">
                <EntityPicker
                  slot="hw_schedule_entity"
                  label="Schedule Entity"
                  value={hwSchedule.entity_id || ''}
                  onChange={(v) =>
                    onUpdate('hw_schedule', { ...hwSchedule, entity_id: v || undefined })
                  }
                  candidates={candidates.hw_schedule_entity || []}
                />
                <div>
                  <label className="block text-xs font-medium text-[var(--text)] mb-1">
                    Attribute Name (optional)
                  </label>
                  <input
                    type="text"
                    value={hwSchedule.attribute_name || ''}
                    onChange={(e) =>
                      onUpdate('hw_schedule', {
                        ...hwSchedule,
                        attribute_name: e.target.value || undefined,
                      })
                    }
                    placeholder="e.g. current_slot"
                    className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                  />
                </div>
              </div>
            )}

            {(hwSchedule.source || 'fixed') === 'fixed' && (
              <div className="pl-4 border-l-2 border-[var(--border)]">
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Start Time
                </label>
                <input
                  type="time"
                  value={hwSchedule.fixed_start_time || '02:30'}
                  onChange={(e) =>
                    onUpdate('hw_schedule', {
                      ...hwSchedule,
                      source: 'fixed',
                      fixed_start_time: e.target.value,
                    })
                  }
                  className="px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
            )}
          </div>

          {/* Cylinder */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-[var(--text)]">Cylinder</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Volume (litres)
                </label>
                <input
                  type="number"
                  value={hwTank.volume_litres ?? 200}
                  onChange={(e) =>
                    onUpdate('hw_tank', {
                      ...hwTank,
                      volume_litres: parseInt(e.target.value) || 200,
                    })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Target Temperature (°C)
                </label>
                <input
                  type="number"
                  value={hwTank.target_temperature ?? 50}
                  onChange={(e) =>
                    onUpdate('hw_tank', {
                      ...hwTank,
                      target_temperature: parseInt(e.target.value) || 50,
                    })
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
            </div>

            {isMqtt ? (
              <TopicPicker
                label="Water Heater State Topic"
                value={hwTank.water_heater_entity || ''}
                onChange={(v) =>
                  onUpdate('hw_tank', { ...hwTank, water_heater_entity: v || undefined })
                }
              />
            ) : (
              <EntityPicker
                slot="water_heater"
                label="Water Heater Entity"
                value={hwTank.water_heater_entity || ''}
                onChange={(v) =>
                  onUpdate('hw_tank', { ...hwTank, water_heater_entity: v || undefined })
                }
                candidates={candidates.water_heater || []}
              />
            )}
            {/* Temperature probes — adjustable 0/1/2 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--text)]">
                  Temperature Probes
                </label>
                <div className="flex gap-1">
                  {(['none', 'single', 'dual'] as const).map((cfg) => (
                    <button
                      key={cfg}
                      onClick={() => {
                        setProbeConfig(cfg)
                        if (cfg === 'none') {
                          onUpdate('hw_tank', { ...hwTank, sensor_top: undefined, sensor_bottom: undefined })
                        } else if (cfg === 'single') {
                          onUpdate('hw_tank', { ...hwTank, sensor_bottom: undefined })
                        }
                      }}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        probeConfig === cfg
                          ? 'bg-[var(--accent)] text-white'
                          : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                      }`}
                    >
                      {cfg === 'none' ? 'None' : cfg === 'single' ? '1 probe' : '2 probes'}
                    </button>
                  ))}
                </div>
              </div>

              {probeConfig === 'none' && (
                <p className="text-xs text-[var(--text-muted)]">
                  No temperature probes — QSH will estimate cylinder temperature from the water heater entity.
                </p>
              )}

              {probeConfig === 'single' && (
                isMqtt ? (
                  <TopicPicker
                    label="Cylinder Temperature Topic"
                    value={hwTank.sensor_top || ''}
                    onChange={(v) =>
                      onUpdate('hw_tank', { ...hwTank, sensor_top: v || undefined, sensor_bottom: undefined })
                    }
                  />
                ) : (
                  <EntityPicker
                    slot="hw_tank_top"
                    label="Cylinder Temperature Sensor"
                    value={hwTank.sensor_top || ''}
                    onChange={(v) =>
                      onUpdate('hw_tank', { ...hwTank, sensor_top: v || undefined, sensor_bottom: undefined })
                    }
                    candidates={candidates.hw_tank_top || []}
                  />
                )
              )}

              {probeConfig === 'dual' && (
                isMqtt ? (
                  <>
                    <TopicPicker
                      label="Top Temperature Topic"
                      value={hwTank.sensor_top || ''}
                      onChange={(v) =>
                        onUpdate('hw_tank', { ...hwTank, sensor_top: v || undefined })
                      }
                    />
                    <TopicPicker
                      label="Bottom Temperature Topic"
                      value={hwTank.sensor_bottom || ''}
                      onChange={(v) =>
                        onUpdate('hw_tank', { ...hwTank, sensor_bottom: v || undefined })
                      }
                    />
                  </>
                ) : (
                  <>
                    <EntityPicker
                      slot="hw_tank_top"
                      label="Top Sensor"
                      value={hwTank.sensor_top || ''}
                      onChange={(v) =>
                        onUpdate('hw_tank', { ...hwTank, sensor_top: v || undefined })
                      }
                      candidates={candidates.hw_tank_top || []}
                    />
                    <EntityPicker
                      slot="hw_tank_bottom"
                      label="Bottom Sensor"
                      value={hwTank.sensor_bottom || ''}
                      onChange={(v) =>
                        onUpdate('hw_tank', { ...hwTank, sensor_bottom: v || undefined })
                      }
                      candidates={candidates.hw_tank_bottom || []}
                    />
                  </>
                )
              )}
            </div>
          </div>

          {/* Pre-charge */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="precharge_enabled"
                checked={hwPrecharge.enabled ?? false}
                onChange={(e) =>
                  onUpdate('hw_precharge', {
                    ...hwPrecharge,
                    enabled: e.target.checked,
                    factor: hwPrecharge.factor ?? 0.5,
                    lead_minutes: hwPrecharge.lead_minutes ?? 60,
                    min_cycle_minutes: hwPrecharge.min_cycle_minutes ?? 30,
                  })
                }
                className="accent-[var(--accent)]"
              />
              <label htmlFor="precharge_enabled" className="text-sm font-medium text-[var(--text)]">
                Enable thermal pre-charging
              </label>
            </div>

            {hwPrecharge.enabled && (
              <div className="grid grid-cols-3 gap-4 pl-4 border-l-2 border-[var(--border)]">
                <div>
                  <label className="block text-xs font-medium text-[var(--text)] mb-1">
                    Factor (0.0–1.0)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={hwPrecharge.factor ?? 0.5}
                    onChange={(e) =>
                      onUpdate('hw_precharge', {
                        ...hwPrecharge,
                        factor: parseFloat(e.target.value) || 0.5,
                      })
                    }
                    className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text)] mb-1">
                    Lead Time (min)
                  </label>
                  <input
                    type="number"
                    value={hwPrecharge.lead_minutes ?? 60}
                    onChange={(e) =>
                      onUpdate('hw_precharge', {
                        ...hwPrecharge,
                        lead_minutes: parseInt(e.target.value) || 60,
                      })
                    }
                    className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text)] mb-1">
                    Min Cycle (min)
                  </label>
                  <input
                    type="number"
                    value={hwPrecharge.min_cycle_minutes ?? 30}
                    onChange={(e) =>
                      onUpdate('hw_precharge', {
                        ...hwPrecharge,
                        min_cycle_minutes: parseInt(e.target.value) || 30,
                      })
                    }
                    className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
