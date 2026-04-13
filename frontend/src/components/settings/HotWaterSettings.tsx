import { useState, useEffect, useMemo } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { patchOrDelete } from '../../hooks/useConfig'
import { useEntityResolve } from '../../hooks/useEntityResolve'
import { EntityField } from './EntityField'
import { TopicField } from './TopicField'
import { HelpTip } from '../HelpTip'
import { HOT_WATER } from '../../lib/helpText'
import type { HwPlanType, HwScheduleYaml, HwTankYaml, HwPrechargeYaml, Driver } from '../../types/config'

const CYLINDER_PLANS: { value: HwPlanType; label: string }[] = [
  { value: 'W', label: 'W — heating OR hot water' },
  { value: 'Y', label: 'Y — simultaneous possible' },
  { value: 'S', label: 'S — separate zone valves' },
  { value: 'S+', label: 'S+ — priority cylinder valve' },
  { value: 'C', label: 'C — combination boiler + cylinder' },
]

type ProbeConfig = 'none' | 'single' | 'dual'

function deriveProbeConfig(tank: HwTankYaml): ProbeConfig {
  if (tank.sensor_top && tank.sensor_bottom) return 'dual'
  if (tank.sensor_top || tank.sensor_bottom) return 'single'
  return 'none'
}

interface HotWaterSettingsProps {
  hwPlan?: HwPlanType
  hwSchedule?: HwScheduleYaml
  hwTank?: HwTankYaml
  hwPrecharge?: HwPrechargeYaml
  driver: Driver
  onRefetch: () => void
}

export function HotWaterSettings({
  hwPlan: initialPlan,
  hwSchedule: initialSchedule,
  hwTank: initialTank,
  hwPrecharge: initialPrecharge,
  driver,
  onRefetch,
}: HotWaterSettingsProps) {
  const hasCylinder = initialPlan !== undefined && initialPlan !== 'Combi'
  const [enabled, setEnabled] = useState(hasCylinder)

  const [plan, setPlan] = useState<HwPlanType>(initialPlan || 'W')
  const [schedule, setSchedule] = useState<HwScheduleYaml>(
    initialSchedule || { source: 'fixed', fixed_start_time: '02:30' }
  )
  const [tank, setTank] = useState<HwTankYaml>(
    initialTank || { volume_litres: 200, target_temperature: 50 }
  )
  const [precharge, setPrecharge] = useState<HwPrechargeYaml>(initialPrecharge || {})
  const [probeConfig, setProbeConfig] = useState<ProbeConfig>(
    deriveProbeConfig(initialTank || {})
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local form state from refetched config is intentional
    setEnabled(initialPlan !== undefined && initialPlan !== 'Combi')
  }, [initialPlan])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local form state from refetched config is intentional
    setPlan(initialPlan || 'W')
  }, [initialPlan])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local form state from refetched config is intentional
    setSchedule(initialSchedule || { source: 'fixed', fixed_start_time: '02:30' })
  }, [initialSchedule])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local form state from refetched config is intentional
    setTank(initialTank || { volume_litres: 200, target_temperature: 50 })
  }, [initialTank])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local form state from refetched config is intentional
    setPrecharge(initialPrecharge || {})
  }, [initialPrecharge])

  // On MQTT, force schedule source to 'fixed' — HA entity schedule is unavailable
  useEffect(() => {
    if (driver === 'mqtt' && schedule.source === 'entity') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- coerce invalid source on driver change
      setSchedule(prev => ({ ...prev, source: 'fixed' }))
    }
  }, [driver, schedule.source])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const entityIds = useMemo(
    () => {
      if (driver === 'mqtt') return []
      return [
        schedule.entity_id,
        tank.water_heater_entity,
        tank.sensor_top,
        tank.sensor_bottom,
      ].filter(Boolean) as string[]
    },
    [schedule.entity_id, tank.water_heater_entity, tank.sensor_top, tank.sensor_bottom, driver]
  )
  const { resolved } = useEntityResolve(entityIds, driver)

  const changeProbeConfig = (config: ProbeConfig) => {
    setProbeConfig(config)
    if (config === 'none') {
      setTank(prev => ({ ...prev, sensor_top: undefined, sensor_bottom: undefined }))
    } else if (config === 'single') {
      // Keep top, clear bottom
      setTank(prev => ({ ...prev, sensor_bottom: undefined }))
    }
    // 'dual' — keep both as-is
  }

  const save = async () => {
    setSaving(true)
    setError(null)

    if (!enabled) {
      // Delete all DHW sections sequentially to avoid config race
      const SECTIONS = ['hw_plan', 'hw_schedule', 'hw_tank', 'hw_precharge'] as const
      const failures: string[] = []
      for (const s of SECTIONS) {
        try { await patchOrDelete(s, false, {}) } catch { failures.push(s) }
      }
      if (failures.length > 0) {
        setError(`Failed to remove: ${failures.join(', ')}. Please retry.`)
      } else {
        onRefetch()
      }
    } else {
      // Save sections sequentially to avoid config race
      const sections: Array<{ name: string; fn: () => Promise<unknown> }> = [
        { name: 'hw_plan', fn: () => patchOrDelete('hw_plan', true, plan as unknown as Record<string, unknown>) },
        { name: 'hw_schedule', fn: () => patchOrDelete('hw_schedule', true, schedule) },
        { name: 'hw_tank', fn: () => patchOrDelete('hw_tank', true, tank) },
        { name: 'hw_precharge', fn: () => patchOrDelete('hw_precharge', precharge.enabled === true, precharge) },
      ]
      const failures: string[] = []
      for (const { name, fn } of sections) {
        try { await fn() } catch { failures.push(name) }
      }
      if (failures.length > 0) {
        setError(`Failed to save: ${failures.join(', ')}. Please retry.`)
      } else {
        onRefetch()
      }
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">Hot Water</h2>
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
        <div className="p-3 rounded-lg bg-[var(--red)]/10 text-[var(--red)] text-sm">{error}</div>
      )}

      {/* Master toggle */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          <span className="text-sm font-medium text-[var(--text)]">
            I have a hot water cylinder
          </span>
        </label>
      </div>

      {enabled && (
        <div className="space-y-6">
          {/* Plan */}
          <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
            <h3 className="text-sm font-medium text-[var(--text)] flex items-center gap-1">Plumbing Plan <HelpTip text={HOT_WATER.plumbingPlan} size={12} /></h3>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as HwPlanType)}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            >
              {CYLINDER_PLANS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Schedule */}
          <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
            <h3 className="text-sm font-medium text-[var(--text)]">Schedule Source</h3>
            <div className="flex gap-3">
              {driver !== 'mqtt' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="schedule_source"
                    checked={schedule.source === 'entity'}
                    onChange={() => setSchedule(prev => ({ ...prev, source: 'entity' }))}
                    className="accent-[var(--accent)]"
                  />
                  <span className="text-sm text-[var(--text)]">HA entity</span>
                </label>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="schedule_source"
                  checked={(schedule.source || 'fixed') === 'fixed'}
                  onChange={() => setSchedule(prev => ({ ...prev, source: 'fixed' }))}
                  className="accent-[var(--accent)]"
                />
                <span className="text-sm text-[var(--text)]">Fixed time</span>
              </label>
            </div>

            {driver === 'mqtt' && (
              <p className="text-xs text-[var(--text-muted)]">
                HA Schedule integration is unavailable on MQTT driver. Use fixed-time scheduling.
              </p>
            )}

            {schedule.source === 'entity' && driver !== 'mqtt' && (
              <div className="space-y-3">
                <EntityField
                  label="Schedule Entity"
                  value={schedule.entity_id || ''}
                  friendlyName={resolved[schedule.entity_id || '']?.friendly_name}
                  state={resolved[schedule.entity_id || '']?.state}
                  unit={resolved[schedule.entity_id || '']?.unit}
                  onChange={(v) => setSchedule(prev => ({ ...prev, entity_id: v || undefined }))}
                  placeholder="binary_sensor.hw_timeframe"
                />
                <div>
                  <label className="block text-xs font-medium text-[var(--text)] mb-1">
                    Attribute Name
                  </label>
                  <input
                    type="text"
                    value={schedule.attribute_name || ''}
                    onChange={(e) =>
                      setSchedule(prev => ({ ...prev, attribute_name: e.target.value || undefined }))
                    }
                    placeholder="e.g. current_slot"
                    className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                  />
                </div>
              </div>
            )}

            {(schedule.source || 'fixed') === 'fixed' && (
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Start Time
                </label>
                <input
                  type="time"
                  value={schedule.fixed_start_time || '02:30'}
                  onChange={(e) =>
                    setSchedule(prev => ({ ...prev, source: 'fixed', fixed_start_time: e.target.value }))
                  }
                  className="px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
            )}
          </div>

          {/* Tank */}
          <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
            <h3 className="text-sm font-medium text-[var(--text)]">Cylinder</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Volume (litres)
                </label>
                <input
                  type="number"
                  value={tank.volume_litres ?? 200}
                  onChange={(e) =>
                    setTank(prev => ({ ...prev, volume_litres: parseInt(e.target.value) || 200 }))
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
                  value={tank.target_temperature ?? 50}
                  onChange={(e) =>
                    setTank(prev => ({ ...prev, target_temperature: parseInt(e.target.value) || 50 }))
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
            </div>

            {/* Water heater entity — HA only */}
            {driver !== 'mqtt' && (
              <EntityField
                label="Water Heater Entity"
                value={tank.water_heater_entity || ''}
                friendlyName={resolved[tank.water_heater_entity || '']?.friendly_name}
                state={resolved[tank.water_heater_entity || '']?.state}
                unit={resolved[tank.water_heater_entity || '']?.unit}
                onChange={(v) => setTank(prev => ({ ...prev, water_heater_entity: v || undefined }))}
                placeholder="water_heater.heat_pump"
                helpText={HOT_WATER.hwSensor}
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
                      onClick={() => changeProbeConfig(cfg)}
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
                driver === 'mqtt' ? (
                  <TopicField
                    label="Cylinder Temperature Topic"
                    value={tank.sensor_top || ''}
                    onChange={(v) =>
                      setTank(prev => ({ ...prev, sensor_top: v || undefined, sensor_bottom: undefined }))
                    }
                    placeholder="temps/hwTopTemp"
                  />
                ) : (
                  <EntityField
                    label="Cylinder Temperature Sensor"
                    value={tank.sensor_top || ''}
                    friendlyName={resolved[tank.sensor_top || '']?.friendly_name}
                    state={resolved[tank.sensor_top || '']?.state}
                    unit={resolved[tank.sensor_top || '']?.unit}
                    onChange={(v) =>
                      setTank(prev => ({ ...prev, sensor_top: v || undefined, sensor_bottom: undefined }))
                    }
                    placeholder="sensor.hw_cylinder_temp"
                  />
                )
              )}

              {probeConfig === 'dual' && (
                <div className="space-y-3">
                  {driver === 'mqtt' ? (
                    <>
                      <TopicField
                        label="Top Probe Topic"
                        value={tank.sensor_top || ''}
                        onChange={(v) => setTank(prev => ({ ...prev, sensor_top: v || undefined }))}
                        placeholder="temps/hwTopTemp"
                      />
                      <TopicField
                        label="Bottom Probe Topic"
                        value={tank.sensor_bottom || ''}
                        onChange={(v) => setTank(prev => ({ ...prev, sensor_bottom: v || undefined }))}
                        placeholder="temps/hwBotTemp"
                      />
                    </>
                  ) : (
                    <>
                      <EntityField
                        label="Top Sensor"
                        value={tank.sensor_top || ''}
                        friendlyName={resolved[tank.sensor_top || '']?.friendly_name}
                        state={resolved[tank.sensor_top || '']?.state}
                        unit={resolved[tank.sensor_top || '']?.unit}
                        onChange={(v) => setTank(prev => ({ ...prev, sensor_top: v || undefined }))}
                        placeholder="sensor.hw_tank_top"
                      />
                      <EntityField
                        label="Bottom Sensor"
                        value={tank.sensor_bottom || ''}
                        friendlyName={resolved[tank.sensor_bottom || '']?.friendly_name}
                        state={resolved[tank.sensor_bottom || '']?.state}
                        unit={resolved[tank.sensor_bottom || '']?.unit}
                        onChange={(v) => setTank(prev => ({ ...prev, sensor_bottom: v || undefined }))}
                        placeholder="sensor.hw_tank_bottom"
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Pre-charge */}
          <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={precharge.enabled ?? false}
                onChange={(e) =>
                  setPrecharge(prev => ({
                    ...prev,
                    enabled: e.target.checked,
                    factor: prev.factor ?? 0.5,
                    lead_minutes: prev.lead_minutes ?? 60,
                    min_cycle_minutes: prev.min_cycle_minutes ?? 30,
                  }))
                }
                className="accent-[var(--accent)]"
              />
              <span className="text-sm font-medium text-[var(--text)] flex items-center gap-1">
                Enable thermal pre-charging <HelpTip text={HOT_WATER.preCharge} size={12} />
              </span>
            </label>

            {precharge.enabled && (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--text)] mb-1">
                    Factor (0.0–1.0)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={precharge.factor ?? 0.5}
                    onChange={(e) =>
                      setPrecharge(prev => ({ ...prev, factor: parseFloat(e.target.value) || 0.5 }))
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
                    value={precharge.lead_minutes ?? 60}
                    onChange={(e) =>
                      setPrecharge(prev => ({ ...prev, lead_minutes: parseInt(e.target.value) || 60 }))
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
                    value={precharge.min_cycle_minutes ?? 30}
                    onChange={(e) =>
                      setPrecharge(prev => ({ ...prev, min_cycle_minutes: parseInt(e.target.value) || 30 }))
                    }
                    className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!enabled && (
        <p className="text-sm text-[var(--text-muted)]">
          No cylinder configured — DHW scheduling is disabled. Enable above to configure hot water.
        </p>
      )}
    </div>
  )
}
