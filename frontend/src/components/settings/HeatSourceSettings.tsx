import { useState, useEffect, useMemo } from 'react'
import { Save, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { usePatchConfig } from '../../hooks/useConfig'
import { useEntityResolve } from '../../hooks/useEntityResolve'
import { apiUrl } from '../../lib/api'
import { cn } from '../../lib/utils'
import { EntityField } from './EntityField'
import { TopicField } from './TopicField'
import { HelpTip } from '../HelpTip'
import { HEAT_SOURCE } from '../../lib/helpText'
import type { HeatSourceYaml, SourceSelectionYaml, QshConfigYaml, MqttConfig, Driver } from '../../types/config'
import { SourceSelectionSettings } from './SourceSelectionSettings'
import { ControlValueDisplay } from './ControlValueDisplay'

interface HeatSourceSettingsProps {
  heatSource: HeatSourceYaml
  heatSources?: HeatSourceYaml[]
  sourceSelection?: SourceSelectionYaml
  rootConfig?: QshConfigYaml
  mqtt?: MqttConfig
  driver: Driver
  onRefetch: () => void
}

export function HeatSourceSettings({ heatSource, heatSources, sourceSelection, rootConfig, mqtt: _mqtt, driver, onRefetch }: HeatSourceSettingsProps) {
  const [hs, setHs] = useState<HeatSourceYaml>(heatSource)
  const { patch, saving } = usePatchConfig()
  const [showSensors, setShowSensors] = useState(false)
  const [showFlowControl, setShowFlowControl] = useState(false)

  useEffect(() => { setHs(heatSource) }, [heatSource])

  const entityIds = useMemo(
    () => {
      // On MQTT, sensor values are topic strings — skip entity resolution
      if (driver === 'mqtt') {
        return [
          hs.flow_min_entity,
          hs.flow_max_entity,
          hs.flow_control?.entity_id,
          hs.flow_control?.flow_entity,
          hs.flow_control?.mode_entity,
          hs.on_off_control?.entity_id,
        ].filter(Boolean) as string[]
      }
      return [
        hs.flow_min_entity,
        hs.flow_max_entity,
        hs.flow_control?.entity_id,
        hs.flow_control?.flow_entity,
        hs.flow_control?.mode_entity,
        hs.on_off_control?.entity_id,
        hs.sensors?.flow_temp,
        hs.sensors?.power_input,
        hs.sensors?.cop,
        hs.sensors?.heat_output,
        hs.sensors?.total_energy,
        hs.sensors?.return_temp,
        hs.sensors?.flow_rate,
        hs.sensors?.delta_t,
        hs.sensors?.water_heater,
      ].filter(Boolean) as string[]
    },
    [hs, driver]
  )
  const { resolved } = useEntityResolve(entityIds, driver)

  const update = (changes: Partial<HeatSourceYaml>) => {
    setHs(prev => ({ ...prev, ...changes }))
  }

  const updateSensor = (key: string, value: string) => {
    setHs(prev => ({ ...prev, sensors: { ...prev.sensors, [key]: value || undefined } }))
  }

  const save = async () => {
    const result = await patch('heat_source', hs)
    if (result) onRefetch()
  }

  const method = hs.flow_control?.method || 'ha_service'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">Heat Source</h2>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Changes
        </button>
      </div>

      {/* Type */}
      <div className="space-y-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <div>
          <label className="flex items-center gap-1 text-sm font-medium text-[var(--text)] mb-2">Type <HelpTip text={HEAT_SOURCE.hpModel} size={12} /></label>
          <div className="flex gap-2">
            {(['heat_pump', 'gas_boiler', 'lpg_boiler', 'oil_boiler'] as const).map((t) => (
              <button
                key={t}
                onClick={() => update({ type: t })}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
                  hs.type === t
                    ? 'border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]'
                    : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/50'
                )}
              >
                {t.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>

        <div className={cn('grid gap-4', driver === 'mqtt' ? 'grid-cols-2' : 'grid-cols-3')}>
          <div>
            <label className="block text-xs font-medium text-[var(--text)] mb-1">
              {hs.type === 'heat_pump' ? 'COP' : 'Efficiency'}
            </label>
            <input
              type="number"
              step="0.1"
              value={hs.efficiency ?? ''}
              onChange={(e) => update({ efficiency: parseFloat(e.target.value) || undefined })}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text)] mb-1">
              Min Output (kW)
            </label>
            <input
              type="number"
              step="0.5"
              value={hs.min_output_kw ?? ''}
              onChange={(e) => update({ min_output_kw: parseFloat(e.target.value) || undefined })}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
          {driver === 'mqtt' ? (
            <div className="col-span-2">
              <label className="block text-xs font-medium text-[var(--text)] mb-1">
                Flow Control Method
              </label>
              <p className="px-2 py-1.5 text-sm text-[var(--text-muted)]">MQTT</p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-[var(--text)] mb-1">
                Flow Control Method
              </label>
              <select
                value={method}
                onChange={(e) =>
                  update({
                    flow_control: { ...hs.flow_control, method: e.target.value as 'ha_service' | 'mqtt' | 'entity' },
                  })
                }
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              >
                <option value="ha_service">HA Service</option>
                <option value="mqtt">MQTT</option>
                <option value="entity">Entity</option>
              </select>
            </div>
          )}
        </div>

        {/* Flow temp range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
              Flow Min (°C) <HelpTip text={HEAT_SOURCE.minFlowTemp} size={12} />
            </label>
            <input
              type="number"
              value={hs.flow_min ?? ''}
              onChange={(e) => update({ flow_min: parseFloat(e.target.value) || undefined })}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-xs font-medium text-[var(--text)] mb-1">
              Flow Max (°C) <HelpTip text={HEAT_SOURCE.maxFlowTemp} size={12} />
            </label>
            <input
              type="number"
              value={hs.flow_max ?? ''}
              onChange={(e) => update({ flow_max: parseFloat(e.target.value) || undefined })}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
        </div>

        {/* Flow min/max entity overrides or internal value editors */}
        {/* On MQTT, hide the entity override rows — flow min/max is internal or via external_setpoints */}
        <div className="grid grid-cols-2 gap-4">
          {driver === 'mqtt' ? (
            <>
              <ControlValueDisplay
                label="Flow Min Temperature"
                controlSource={undefined}
                internalValue={rootConfig?.flow_min_internal ?? hs.flow_min ?? 25}
                onInternalChange={(v) => {
                  if (typeof v === 'number') {
                    fetch(apiUrl('api/control/flow-min'), {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ value: v }),
                    }).then(() => onRefetch())
                  }
                }}
                unit="°C"
                min={20}
                max={45}
                step={0.5}
              />
              <ControlValueDisplay
                label="Flow Max Temperature"
                controlSource={undefined}
                internalValue={rootConfig?.flow_max_internal ?? hs.flow_max ?? 50}
                onInternalChange={(v) => {
                  if (typeof v === 'number') {
                    fetch(apiUrl('api/control/flow-max'), {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ value: v }),
                    }).then(() => onRefetch())
                  }
                }}
                unit="°C"
                min={30}
                max={60}
                step={0.5}
              />
            </>
          ) : (
            <>
              {hs.flow_min_entity ? (
                <EntityField
                  label="Flow Min Entity"
                  value={hs.flow_min_entity}
                  friendlyName={resolved[hs.flow_min_entity]?.friendly_name}
                  state={resolved[hs.flow_min_entity]?.state}
                  unit={resolved[hs.flow_min_entity]?.unit}
                  onChange={(v) => update({ flow_min_entity: v || undefined })}
                  placeholder="input_number.flow_min"
                />
              ) : (
                <ControlValueDisplay
                  label="Flow Min Temperature"
                  controlSource={undefined}
                  internalValue={rootConfig?.flow_min_internal ?? hs.flow_min ?? 25}
                  onInternalChange={(v) => {
                    if (typeof v === 'number') {
                      fetch(apiUrl('api/control/flow-min'), {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ value: v }),
                      }).then(() => onRefetch())
                    }
                  }}
                  unit="°C"
                  min={20}
                  max={45}
                  step={0.5}
                />
              )}
              {hs.flow_max_entity ? (
                <EntityField
                  label="Flow Max Entity"
                  value={hs.flow_max_entity}
                  friendlyName={resolved[hs.flow_max_entity]?.friendly_name}
                  state={resolved[hs.flow_max_entity]?.state}
                  unit={resolved[hs.flow_max_entity]?.unit}
                  onChange={(v) => update({ flow_max_entity: v || undefined })}
                  placeholder="input_number.flow_max"
                />
              ) : (
                <ControlValueDisplay
                  label="Flow Max Temperature"
                  controlSource={undefined}
                  internalValue={rootConfig?.flow_max_internal ?? hs.flow_max ?? 50}
                  onInternalChange={(v) => {
                    if (typeof v === 'number') {
                      fetch(apiUrl('api/control/flow-max'), {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ value: v }),
                      }).then(() => onRefetch())
                    }
                  }}
                  unit="°C"
                  min={30}
                  max={60}
                  step={0.5}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Flow Control Details */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <button
          onClick={() => setShowFlowControl(!showFlowControl)}
          className="flex items-center gap-2 text-sm font-medium text-[var(--text)]"
        >
          {showFlowControl ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Flow & On/Off Control Details
        </button>

        {showFlowControl && (
          <div className="space-y-4 pl-4 border-l-2 border-[var(--border)]">
            {driver === 'mqtt' ? (
              <div className="grid grid-cols-2 gap-4">
                <TopicField
                  label="Flow Temp Set Topic"
                  value={hs.flow_control?.topic || ''}
                  onChange={(v) =>
                    update({ flow_control: { ...hs.flow_control, topic: v || undefined } })
                  }
                  placeholder="heat_pump/flow_temp/set"
                />
                <TopicField
                  label="Mode Topic"
                  value={hs.flow_control?.mode_topic || ''}
                  onChange={(v) =>
                    update({ flow_control: { ...hs.flow_control, mode_topic: v || undefined } })
                  }
                  placeholder="heat_pump/mode/set"
                />
              </div>
            ) : (
              <>
                {method === 'ha_service' && (
                  <div className="grid grid-cols-3 gap-4">
                    <EntityField
                      label="Domain"
                      value={hs.flow_control?.domain || ''}
                      onChange={(v) =>
                        update({ flow_control: { ...hs.flow_control, domain: v || undefined } })
                      }
                      placeholder="climate"
                    />
                    <EntityField
                      label="Service"
                      value={hs.flow_control?.service || ''}
                      onChange={(v) =>
                        update({ flow_control: { ...hs.flow_control, service: v || undefined } })
                      }
                      placeholder="set_temperature"
                    />
                    <EntityField
                      label="Entity ID"
                      value={hs.flow_control?.entity_id || ''}
                      onChange={(v) =>
                        update({ flow_control: { ...hs.flow_control, entity_id: v || undefined } })
                      }
                      placeholder="climate.heat_pump"
                    />
                  </div>
                )}
                {method === 'mqtt' && (
                  <div className="grid grid-cols-2 gap-4">
                    <EntityField
                      label="Topic"
                      value={hs.flow_control?.topic || ''}
                      onChange={(v) =>
                        update({ flow_control: { ...hs.flow_control, topic: v || undefined } })
                      }
                      placeholder="heat_pump/flow_temp/set"
                    />
                    <EntityField
                      label="Mode Topic"
                      value={hs.flow_control?.mode_topic || ''}
                      onChange={(v) =>
                        update({ flow_control: { ...hs.flow_control, mode_topic: v || undefined } })
                      }
                      placeholder="heat_pump/mode/set"
                    />
                  </div>
                )}
                {method === 'entity' && (
                  <div className="grid grid-cols-2 gap-4">
                    <EntityField
                      label="Flow Entity"
                      value={hs.flow_control?.flow_entity || ''}
                      onChange={(v) =>
                        update({ flow_control: { ...hs.flow_control, flow_entity: v || undefined } })
                      }
                      placeholder="input_number.flow_temp"
                    />
                    <EntityField
                      label="Mode Entity"
                      value={hs.flow_control?.mode_entity || ''}
                      onChange={(v) =>
                        update({ flow_control: { ...hs.flow_control, mode_entity: v || undefined } })
                      }
                      placeholder="input_select.hp_mode"
                    />
                  </div>
                )}
              </>
            )}

            {driver !== 'mqtt' && (
              <>
                <h4 className="text-xs font-medium text-[var(--text)] mt-2">On/Off Control</h4>
                <div className="grid grid-cols-3 gap-4">
                  <EntityField
                    label="Domain"
                    value={hs.on_off_control?.domain || ''}
                    onChange={(v) =>
                      update({ on_off_control: { ...hs.on_off_control, domain: v || undefined } })
                    }
                    placeholder="climate"
                  />
                  <EntityField
                    label="Service"
                    value={hs.on_off_control?.service || ''}
                    onChange={(v) =>
                      update({ on_off_control: { ...hs.on_off_control, service: v || undefined } })
                    }
                    placeholder="turn_on"
                  />
                  <EntityField
                    label="Entity ID"
                    value={hs.on_off_control?.entity_id || ''}
                    onChange={(v) =>
                      update({ on_off_control: { ...hs.on_off_control, entity_id: v || undefined } })
                    }
                    placeholder="climate.heat_pump"
                  />
                </div>
                <EntityField
                  label="Device ID (Octopus)"
                  value={hs.on_off_control?.device_id || ''}
                  onChange={(v) =>
                    update({ on_off_control: { ...hs.on_off_control, device_id: v || undefined } })
                  }
                  placeholder="abc123def456..."
                />
              </>
            )}

          </div>
        )}
      </div>

      {/* Sensors */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <button
          onClick={() => setShowSensors(!showSensors)}
          className="flex items-center gap-2 text-sm font-medium text-[var(--text)]"
        >
          {showSensors ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {driver === 'mqtt' ? 'Sensor Topics' : 'Sensor Entities'}
        </button>

        {showSensors && (
          <div className="space-y-3 pl-4 border-l-2 border-[var(--border)]">
            {driver === 'mqtt' ? (
              <>
                {([
                  ['flow_temp', 'Flow Temperature', 'heat_pump/flow_temp'],
                  ['power_input', 'Power Input', 'heat_pump/power'],
                  ['cop', 'COP', 'heat_pump/cop'],
                  ['heat_output', 'Heat Output', 'heat_pump/heat_output'],
                  ['total_energy', 'Total Energy', 'heat_pump/total_energy'],
                  ['return_temp', 'Return Temperature', 'heat_pump/return_temp'],
                  ['flow_rate', 'Flow Rate', 'heat_pump/flow_rate'],
                  ['delta_t', 'Delta-T', 'heat_pump/delta_t'],
                  ['water_heater', 'Water Heater', 'heat_pump/water_heater'],
                ] as const).map(([key, label, placeholder]) => (
                  <TopicField
                    key={key}
                    label={label}
                    value={hs.sensors?.[key] || ''}
                    onChange={(v) => updateSensor(key, v)}
                    placeholder={placeholder}
                  />
                ))}
              </>
            ) : (
              <>
                <EntityField
                  label="Flow Temperature"
                  value={hs.sensors?.flow_temp || ''}
                  friendlyName={resolved[hs.sensors?.flow_temp || '']?.friendly_name}
                  state={resolved[hs.sensors?.flow_temp || '']?.state}
                  unit={resolved[hs.sensors?.flow_temp || '']?.unit}
                  onChange={(v) => updateSensor('flow_temp', v)}
                  placeholder="sensor.hp_flow_temp"
                />
                <EntityField
                  label="Power Input"
                  value={hs.sensors?.power_input || ''}
                  friendlyName={resolved[hs.sensors?.power_input || '']?.friendly_name}
                  state={resolved[hs.sensors?.power_input || '']?.state}
                  unit={resolved[hs.sensors?.power_input || '']?.unit}
                  onChange={(v) => updateSensor('power_input', v)}
                  placeholder="sensor.hp_power"
                />
                <EntityField
                  label="COP"
                  value={hs.sensors?.cop || ''}
                  friendlyName={resolved[hs.sensors?.cop || '']?.friendly_name}
                  state={resolved[hs.sensors?.cop || '']?.state}
                  unit={resolved[hs.sensors?.cop || '']?.unit}
                  onChange={(v) => updateSensor('cop', v)}
                  placeholder="sensor.hp_cop"
                />
                <EntityField
                  label="Heat Output"
                  value={hs.sensors?.heat_output || ''}
                  friendlyName={resolved[hs.sensors?.heat_output || '']?.friendly_name}
                  state={resolved[hs.sensors?.heat_output || '']?.state}
                  unit={resolved[hs.sensors?.heat_output || '']?.unit}
                  onChange={(v) => updateSensor('heat_output', v)}
                  placeholder="sensor.hp_heat_output"
                />
                <EntityField
                  label="Total Energy"
                  value={hs.sensors?.total_energy || ''}
                  friendlyName={resolved[hs.sensors?.total_energy || '']?.friendly_name}
                  state={resolved[hs.sensors?.total_energy || '']?.state}
                  unit={resolved[hs.sensors?.total_energy || '']?.unit}
                  onChange={(v) => updateSensor('total_energy', v)}
                  placeholder="sensor.hp_total_energy"
                />
                <EntityField
                  label="Return Temperature"
                  value={hs.sensors?.return_temp || ''}
                  friendlyName={resolved[hs.sensors?.return_temp || '']?.friendly_name}
                  state={resolved[hs.sensors?.return_temp || '']?.state}
                  unit={resolved[hs.sensors?.return_temp || '']?.unit}
                  onChange={(v) => updateSensor('return_temp', v)}
                  placeholder="sensor.hp_return_temp"
                />
                <EntityField
                  label="Flow Rate"
                  value={hs.sensors?.flow_rate || ''}
                  friendlyName={resolved[hs.sensors?.flow_rate || '']?.friendly_name}
                  state={resolved[hs.sensors?.flow_rate || '']?.state}
                  unit={resolved[hs.sensors?.flow_rate || '']?.unit}
                  onChange={(v) => updateSensor('flow_rate', v)}
                  placeholder="sensor.hp_flow_rate"
                />
                <EntityField
                  label="Delta-T"
                  value={hs.sensors?.delta_t || ''}
                  friendlyName={resolved[hs.sensors?.delta_t || '']?.friendly_name}
                  state={resolved[hs.sensors?.delta_t || '']?.state}
                  unit={resolved[hs.sensors?.delta_t || '']?.unit}
                  onChange={(v) => updateSensor('delta_t', v)}
                  placeholder="sensor.hp_delta_t"
                />
                <EntityField
                  label="Water Heater"
                  value={hs.sensors?.water_heater || ''}
                  friendlyName={resolved[hs.sensors?.water_heater || '']?.friendly_name}
                  state={resolved[hs.sensors?.water_heater || '']?.state}
                  unit={resolved[hs.sensors?.water_heater || '']?.unit}
                  onChange={(v) => updateSensor('water_heater', v)}
                  placeholder="water_heater.heat_pump"
                />
              </>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-[var(--amber)]">
        Changing heat source type will trigger a pipeline restart.
      </p>

      {/* Source Selection Settings (multi-source only) */}
      {heatSources && heatSources.length > 1 && sourceSelection && (
        <SourceSelectionSettings
          config={sourceSelection}
          sourceNames={heatSources.map(s => s.name ?? s.type)}
          onRefetch={onRefetch}
        />
      )}
    </div>
  )
}
