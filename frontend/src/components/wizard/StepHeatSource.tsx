import { Flame, Droplets, Fuel } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { HeatSourceYaml, QshConfigYaml } from '../../types/config'

interface StepHeatSourceProps {
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

const HEAT_SOURCES = [
  { type: 'heat_pump', label: 'Heat Pump', icon: Droplets, desc: 'ASHP, GSHP, or hybrid' },
  { type: 'gas_boiler', label: 'Gas Boiler', icon: Flame, desc: 'Natural gas' },
  { type: 'lpg_boiler', label: 'LPG Boiler', icon: Flame, desc: 'LPG-fired boiler' },
  { type: 'oil_boiler', label: 'Oil Boiler', icon: Fuel, desc: 'Oil-fired boiler' },
] as const

const FLOW_METHODS = [
  { method: 'ha_service', label: 'HA Service Call', desc: 'Standard HA climate service (most common)' },
  { method: 'mqtt', label: 'MQTT', desc: 'Direct MQTT topic control' },
  { method: 'entity', label: 'Entity', desc: 'Write to an input_number entity' },
] as const

export function StepHeatSource({ config, onUpdate }: StepHeatSourceProps) {
  const hs = config.heat_source ?? {} as Partial<HeatSourceYaml>
  const isMqttDriver = config.driver === 'mqtt'

  const update = (changes: Partial<HeatSourceYaml>) => {
    onUpdate('heat_source', { ...hs, ...changes })
  }

  const updateFlowControl = (changes: Record<string, unknown>) => {
    const fc = hs.flow_control || {}
    update({ flow_control: { ...fc, ...changes } })
  }

  const updateOnOff = (changes: Record<string, unknown>) => {
    const oo = hs.on_off_control || {}
    update({ on_off_control: { ...oo, ...changes } })
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">Heat Source</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Select your heating system type and how QSH should control it.
        </p>
      </div>

      {/* Type selection */}
      <div>
        <label className="block text-sm font-medium text-[var(--text)] mb-3">
          System Type
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {HEAT_SOURCES.map(({ type, label, icon: Icon, desc }) => (
            <button
              key={type}
              onClick={() => update({ type })}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-lg border text-sm transition-colors',
                hs.type === type
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                  : 'border-[var(--border)] hover:border-[var(--accent)]/50'
              )}
            >
              <Icon size={24} className={hs.type === type ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
              <span className="font-medium">{label}</span>
              <span className="text-xs text-[var(--text-muted)]">{desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Efficiency */}
      {hs.type && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              {hs.type === 'heat_pump' ? 'Expected COP' : 'Efficiency'}
            </label>
            <input
              type="number"
              step="0.1"
              value={hs.efficiency ?? (hs.type === 'heat_pump' ? 3.0 : 0.85)}
              onChange={(e) => update({ efficiency: parseFloat(e.target.value) || undefined })}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {hs.type === 'heat_pump' ? 'Typical: 2.5-4.0' : 'Typical: 0.80-0.95'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Min Output (kW)
            </label>
            <input
              type="number"
              step="0.5"
              value={hs.min_output_kw ?? 2.0}
              onChange={(e) => update({ min_output_kw: parseFloat(e.target.value) || undefined })}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Minimum compressor/burner output
            </p>
          </div>
        </div>
      )}

      {/* Flow control method */}
      {hs.type && isMqttDriver && (
        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-3">
            Flow Temperature Control
          </label>
          <div className="p-3 rounded-lg border border-[var(--accent)] bg-[var(--accent)]/5">
            <span className="text-sm font-medium text-[var(--text)]">MQTT</span>
            <p className="text-xs text-[var(--text-muted)]">
              Flow temperature and mode controlled via MQTT output topics (configured on the MQTT Broker step)
            </p>
          </div>
        </div>
      )}
      {hs.type && !isMqttDriver && (
        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-3">
            Flow Temperature Control
          </label>
          <div className="space-y-2">
            {FLOW_METHODS.map(({ method, label, desc }) => (
              <label
                key={method}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                  hs.flow_control?.method === method
                    ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                    : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                )}
              >
                <input
                  type="radio"
                  name="flow_method"
                  checked={hs.flow_control?.method === method}
                  onChange={() => updateFlowControl({ method })}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <div>
                  <span className="text-sm font-medium text-[var(--text)]">{label}</span>
                  <p className="text-xs text-[var(--text-muted)]">{desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Method-specific fields (HA only) */}
      {!isMqttDriver && hs.flow_control?.method === 'ha_service' && (
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Domain"
            value={hs.flow_control?.domain || ''}
            onChange={(v) => updateFlowControl({ domain: v })}
            placeholder="climate"
          />
          <InputField
            label="Service"
            value={hs.flow_control?.service || ''}
            onChange={(v) => updateFlowControl({ service: v })}
            placeholder="set_temperature"
          />
          <div className="col-span-2">
            <InputField
              label="Entity ID"
              value={hs.flow_control?.entity_id || ''}
              onChange={(v) => updateFlowControl({ entity_id: v })}
              placeholder="climate.my_heat_pump"
            />
          </div>
        </div>
      )}

      {!isMqttDriver && hs.flow_control?.method === 'mqtt' && (
        <InputField
          label="MQTT Topic"
          value={hs.flow_control?.topic || ''}
          onChange={(v) => updateFlowControl({ topic: v })}
          placeholder="qsh/heat_pump/flow_temp/set"
        />
      )}

      {!isMqttDriver && hs.flow_control?.method === 'entity' && (
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Flow Entity"
            value={hs.flow_control?.flow_entity || ''}
            onChange={(v) => updateFlowControl({ flow_entity: v })}
            placeholder="input_number.qsh_target_flow_temp"
          />
          <InputField
            label="Mode Entity"
            value={hs.flow_control?.mode_entity || ''}
            onChange={(v) => updateFlowControl({ mode_entity: v })}
            placeholder="input_text.qsh_target_mode"
          />
        </div>
      )}

      {/* On/Off control (HA only) */}
      {hs.type && !isMqttDriver && (
        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-1">
            On/Off Control (optional)
          </label>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            How QSH turns the heat source on and off
          </p>
          <div className="grid grid-cols-3 gap-4">
            <InputField
              label="Domain"
              value={hs.on_off_control?.domain || ''}
              onChange={(v) => updateOnOff({ domain: v })}
              placeholder="climate"
            />
            <InputField
              label="Service"
              value={hs.on_off_control?.service || ''}
              onChange={(v) => updateOnOff({ service: v })}
              placeholder="set_hvac_mode"
            />
            <InputField
              label="Entity ID"
              value={hs.on_off_control?.entity_id || ''}
              onChange={(v) => updateOnOff({ entity_id: v })}
              placeholder="climate.my_heat_pump"
            />
          </div>
        </div>
      )}

      {/* Flow temp range */}
      {hs.type && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Min Flow Temp
            </label>
            <input
              type="number"
              value={hs.flow_min ?? 25}
              onChange={(e) => update({ flow_min: parseFloat(e.target.value) || 25 })}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Max Flow Temp
            </label>
            <input
              type="number"
              value={hs.flow_max ?? 55}
              onChange={(e) => update({ flow_max: parseFloat(e.target.value) || 55 })}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
            />
          </div>
        </div>
      )}

      {/* MQTT shadow publishing toggle */}
      {hs.type && isMqttDriver && (
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-sm font-medium text-[var(--text)]">
                Publish MQTT Shadow Topics
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                When enabled, QSH publishes shadow metrics and state to MQTT topics under your prefix/shadow/.
                Disable if you only use the QSH Web interface.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onUpdate('root', { publish_mqtt_shadow: !(config.publish_mqtt_shadow ?? true) })
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ml-4 ${
                (config.publish_mqtt_shadow ?? true)
                  ? 'bg-[var(--accent)]'
                  : 'bg-[var(--border)]'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  (config.publish_mqtt_shadow ?? true)
                    ? 'translate-x-6'
                    : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[var(--text)] mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
      />
    </div>
  )
}
