import { useState } from 'react'
import { Search, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { EntityPicker } from './EntityPicker'
import { TopicPicker } from './TopicPicker'
import { TopicDiscoveryPanel } from './TopicDiscoveryPanel'
import { useEntityScan } from '../../hooks/useEntityScan'
import type {
  HeatSourceYaml, OutdoorYaml, SolarYaml, BatteryYaml, GridYaml,
  MqttConfig, MqttTopicInput, MqttTopicCandidate,
} from '../../types/config'

interface StepSensorsProps {
  config: Record<string, unknown>
  onUpdate: (section: string, data: unknown) => void
}

const MQTT_SENSOR_FIELDS = [
  { key: 'outdoor_temp', label: 'Outdoor Temperature', hint: 'recommended' },
  { key: 'hp_flow_temp', label: 'HP Flow Temperature', hint: 'recommended' },
  { key: 'hp_return_temp', label: 'HP Return Temperature', hint: 'optional' },
  { key: 'hp_power', label: 'HP Power Input', hint: 'recommended' },
  { key: 'hp_cop', label: 'HP COP', hint: 'optional' },
  { key: 'hp_heat_output', label: 'HP Heat Output', hint: 'optional' },
  { key: 'hp_mode_state', label: 'HP Mode State', hint: 'optional' },
  { key: 'flow_rate', label: 'Flow Rate', hint: 'optional' },
] as const

export function StepSensors({ config, onUpdate }: StepSensorsProps) {
  const isMqtt = config.driver === 'mqtt'

  if (isMqtt) {
    return <MqttSensors config={config} onUpdate={onUpdate} />
  }
  return <HaSensors config={config} onUpdate={onUpdate} />
}

/** HA path — unchanged from original. */
function HaSensors({ config, onUpdate }: StepSensorsProps) {
  const { candidates, loading, error, scan } = useEntityScan()
  const hs: HeatSourceYaml = (config.heat_source as HeatSourceYaml) || {}
  const outdoor: OutdoorYaml = (config.outdoor as OutdoorYaml) || {}
  const sensors = hs.sensors || {}
  const [showAdditionalHP, setShowAdditionalHP] = useState(false)

  const [hasSolar, setHasSolar] = useState(
    !!(config.solar as SolarYaml | undefined)?.production_entity
  )
  const [hasBattery, setHasBattery] = useState(
    !!(config.battery as BatteryYaml | undefined)?.soc_entity
  )

  const updateSensor = (key: string, value: string) => {
    const newSensors = { ...sensors, [key]: value || undefined }
    onUpdate('heat_source', { ...hs, sensors: newSensors })
  }

  const updateOutdoor = (key: string, value: string) => {
    onUpdate('outdoor', { ...outdoor, [key]: value || undefined })
  }

  const toggleSolar = (enabled: boolean) => {
    setHasSolar(enabled)
    if (!enabled) {
      onUpdate('solar', undefined)
      onUpdate('inverter', undefined)
    }
  }

  const toggleBattery = (enabled: boolean) => {
    setHasBattery(enabled)
    if (!enabled) {
      onUpdate('battery', undefined)
      onUpdate('grid', undefined)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">Sensors</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Map your HA sensor entities to QSH. Click &quot;Scan HA&quot; to auto-detect candidates.
        </p>
      </div>

      <button
        onClick={() => scan()}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
        {loading ? 'Scanning...' : 'Scan HA'}
      </button>

      {error && (
        <p className="text-sm text-[var(--red)]">{error}</p>
      )}

      {/* Essential HP Sensors */}
      <div>
        <h3 className="text-sm font-medium text-[var(--text)] mb-3">
          Essential Heat Pump Sensors
        </h3>
        <div className="space-y-4">
          <EntityPicker
            slot="hp_flow_temp"
            label="Flow Temperature"
            value={sensors.flow_temp || ''}
            onChange={(v) => updateSensor('flow_temp', v)}
            candidates={candidates.hp_flow_temp || []}
          />
          <EntityPicker
            slot="hp_power"
            label="Power Input"
            value={sensors.power_input || ''}
            onChange={(v) => updateSensor('power_input', v)}
            candidates={candidates.hp_power || []}
          />
          <EntityPicker
            slot="hp_cop"
            label="COP Sensor"
            value={sensors.cop || ''}
            onChange={(v) => updateSensor('cop', v)}
            candidates={candidates.hp_cop || []}
          />
        </div>
      </div>

      {/* Additional HP Sensors (collapsible) */}
      <div>
        <button
          onClick={() => setShowAdditionalHP(!showAdditionalHP)}
          className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {showAdditionalHP ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Additional HP Sensors (optional)
        </button>
        {showAdditionalHP && (
          <div className="space-y-4 mt-3">
            <EntityPicker
              slot="hp_heat_output"
              label="Heat Output"
              value={sensors.heat_output || ''}
              onChange={(v) => updateSensor('heat_output', v)}
              candidates={candidates.hp_heat_output || []}
            />
            <EntityPicker
              slot="hp_total_energy"
              label="Total Energy"
              value={sensors.total_energy || ''}
              onChange={(v) => updateSensor('total_energy', v)}
              candidates={candidates.hp_total_energy || []}
            />
            <div className="grid grid-cols-2 gap-4">
              <EntityPicker
                slot="hp_return_temp"
                label="Return Temperature"
                value={sensors.return_temp || ''}
                onChange={(v) => updateSensor('return_temp', v)}
                candidates={candidates.hp_return_temp || []}
              />
              <EntityPicker
                slot="hp_delta_t"
                label="Delta-T"
                value={sensors.delta_t || ''}
                onChange={(v) => updateSensor('delta_t', v)}
                candidates={[]}
              />
            </div>
            <EntityPicker
              slot="hp_flow_rate"
              label="Flow Rate"
              value={sensors.flow_rate || ''}
              onChange={(v) => updateSensor('flow_rate', v)}
              candidates={candidates.hp_flow_rate || []}
            />
            <EntityPicker
              slot="hp_water_heater"
              label="Water Heater Entity"
              value={sensors.water_heater || ''}
              onChange={(v) => updateSensor('water_heater', v)}
              candidates={candidates.hp_water_heater || []}
            />
          </div>
        )}
      </div>

      {/* Outdoor */}
      <div>
        <h3 className="text-sm font-medium text-[var(--text)] mb-3">
          Outdoor & Weather
        </h3>
        <div className="space-y-4">
          <EntityPicker
            slot="outdoor_temp"
            label="Outdoor Temperature"
            value={outdoor.temperature || ''}
            onChange={(v) => updateOutdoor('temperature', v)}
            candidates={candidates.outdoor_temp || []}
          />
          <EntityPicker
            slot="weather_forecast"
            label="Weather Forecast"
            value={outdoor.weather_forecast || ''}
            onChange={(v) => updateOutdoor('weather_forecast', v)}
            candidates={candidates.weather_forecast || []}
          />
        </div>
      </div>

      {/* Solar & Battery */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-[var(--text)]">
          Solar & Battery (optional)
        </h3>

        {/* Solar toggle */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--text)]">Do you have solar panels?</span>
            <div className="flex gap-2">
              <button
                onClick={() => toggleSolar(true)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  hasSolar
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                Yes
              </button>
              <button
                onClick={() => toggleSolar(false)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  !hasSolar
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                No
              </button>
            </div>
          </div>
          {hasSolar && (
            <EntityPicker
              slot="solar_production"
              label="Solar Production"
              value={(config.solar as SolarYaml | undefined)?.production_entity || ''}
              onChange={(v) =>
                onUpdate('solar', { ...(config.solar as object || {}), production_entity: v || undefined })
              }
              candidates={candidates.solar_production || []}
            />
          )}
        </div>

        {/* Battery toggle */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--text)]">Do you have a home battery?</span>
            <div className="flex gap-2">
              <button
                onClick={() => toggleBattery(true)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  hasBattery
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                Yes
              </button>
              <button
                onClick={() => toggleBattery(false)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  !hasBattery
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                No
              </button>
            </div>
          </div>
          {hasBattery && (
            <div className="space-y-4">
              <EntityPicker
                slot="battery_soc"
                label="Battery SoC"
                value={(config.battery as BatteryYaml | undefined)?.soc_entity || ''}
                onChange={(v) =>
                  onUpdate('battery', { ...(config.battery as object || {}), soc_entity: v || undefined })
                }
                candidates={candidates.battery_soc || []}
              />
              <EntityPicker
                slot="grid_power"
                label="Grid Power"
                value={(config.grid as GridYaml | undefined)?.power_entity || ''}
                onChange={(v) =>
                  onUpdate('grid', { ...(config.grid as object || {}), power_entity: v || undefined })
                }
                candidates={candidates.grid_power || []}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** MQTT path — TopicPicker for each sensor field. */
function MqttSensors({ config, onUpdate }: StepSensorsProps) {
  const mqtt: MqttConfig = (config.mqtt as MqttConfig) || { broker: '', port: 1883, inputs: {} }
  const inputs = mqtt.inputs || {}
  const [scanResults, setScanResults] = useState<MqttTopicCandidate[]>([])
  const [showAdditional, setShowAdditional] = useState(false)

  const [hasSolar, setHasSolar] = useState(!!inputs.solar_production?.topic)
  const [hasBattery, setHasBattery] = useState(!!inputs.battery_soc?.topic)

  const updateInput = (key: string, topic: string, format?: string, jsonPath?: string) => {
    const newInputs = { ...inputs }
    if (topic) {
      const entry: MqttTopicInput = { topic, format: (format || 'plain') as 'plain' | 'json' }
      if (jsonPath) entry.json_path = jsonPath
      newInputs[key] = entry
    } else {
      delete newInputs[key]
    }
    onUpdate('mqtt', { ...mqtt, inputs: newInputs })
  }

  const getInputTopic = (key: string): string => inputs[key]?.topic || ''

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">Sensors</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Map your MQTT sensor topics. Click &quot;Scan Broker&quot; to discover available topics.
        </p>
      </div>

      <TopicDiscoveryPanel mqtt={mqtt} onResults={setScanResults} />

      {/* Core sensors */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-[var(--text)]">Core Sensors</h3>
        {MQTT_SENSOR_FIELDS.slice(0, 4).map(({ key, label, hint }) => (
          <TopicPicker
            key={key}
            label={`${label} (${hint})`}
            value={getInputTopic(key)}
            onChange={(v) => updateInput(key, v)}
            scanResults={scanResults}
            required={hint === 'recommended'}
          />
        ))}
      </div>

      {/* Additional sensors */}
      <div>
        <button
          onClick={() => setShowAdditional(!showAdditional)}
          className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {showAdditional ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Additional Sensors (optional)
        </button>
        {showAdditional && (
          <div className="space-y-4 mt-3">
            {MQTT_SENSOR_FIELDS.slice(4).map(({ key, label }) => (
              <TopicPicker
                key={key}
                label={label}
                value={getInputTopic(key)}
                onChange={(v) => updateInput(key, v)}
                scanResults={scanResults}
              />
            ))}
          </div>
        )}
      </div>

      {/* Solar & Battery */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-[var(--text)]">Solar & Battery (optional)</h3>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--text)]">Do you have solar panels?</span>
            <div className="flex gap-2">
              <button
                onClick={() => setHasSolar(true)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  hasSolar
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                Yes
              </button>
              <button
                onClick={() => { setHasSolar(false); updateInput('solar_production', '') }}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  !hasSolar
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                No
              </button>
            </div>
          </div>
          {hasSolar && (
            <TopicPicker
              label="Solar Production"
              value={getInputTopic('solar_production')}
              onChange={(v) => updateInput('solar_production', v)}
              scanResults={scanResults}
            />
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--text)]">Do you have a home battery?</span>
            <div className="flex gap-2">
              <button
                onClick={() => setHasBattery(true)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  hasBattery
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                Yes
              </button>
              <button
                onClick={() => { setHasBattery(false); updateInput('battery_soc', ''); updateInput('grid_power', '') }}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  !hasBattery
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                No
              </button>
            </div>
          </div>
          {hasBattery && (
            <div className="space-y-4">
              <TopicPicker
                label="Battery SoC"
                value={getInputTopic('battery_soc')}
                onChange={(v) => updateInput('battery_soc', v)}
                scanResults={scanResults}
              />
              <TopicPicker
                label="Grid Power"
                value={getInputTopic('grid_power')}
                onChange={(v) => updateInput('grid_power', v)}
                scanResults={scanResults}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
