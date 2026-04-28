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

// Core sensors — always visible in the wizard flow.
const MQTT_CORE_SENSOR_FIELDS = [
  { key: 'outdoor_temp', label: 'Outdoor Temperature', hint: 'recommended', helper: '' },
  { key: 'hp_flow_temp', label: 'HP Flow Temperature', hint: 'recommended', helper: '' },
  { key: 'hp_return_temp', label: 'HP Return Temperature', hint: 'optional', helper: '' },
  {
    key: 'flow_rate',
    label: 'Flow rate sensor',
    hint: 'optional',
    helper:
      'Live flow rate (L/min) improves COP calculation. Leave blank if your heat pump does not expose flow rate.',
  },
  { key: 'hp_power', label: 'HP Power Input', hint: 'recommended', helper: '' },
] as const

// Additional sensors — collapsed by default.
const MQTT_ADDITIONAL_SENSOR_FIELDS = [
  { key: 'hp_cop', label: 'HP COP', hint: 'optional', helper: '' },
  { key: 'hp_heat_output', label: 'HP Heat Output', hint: 'optional', helper: '' },
  { key: 'hp_mode_state', label: 'HP Mode State', hint: 'optional', helper: '' },
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
  const [lastScanCompletedAt, setLastScanCompletedAt] = useState<number | null>(null)
  const [prevLoading, setPrevLoading] = useState<boolean>(false)

  // Falling-edge detector for `loading`: bump completion counter when
  // loading transitions true -> false with no error. Implemented via
  // React's documented "storing information from previous renders" pattern
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders),
  // which allows guarded setState during render.
  if (loading !== prevLoading) {
    setPrevLoading(loading)
    if (prevLoading === true && loading === false && error === null) {
      setLastScanCompletedAt((prev) => (prev ?? 0) + 1)
    }
  }

  const candidateCount = Object.values(candidates).reduce((n, arr) => n + arr.length, 0)

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
        <p className="text-xs text-[var(--text-muted)] mt-1">
          <span className="text-[var(--red)]">*</span> <span>Mandatory</span>
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => scan()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          {loading ? 'Scanning...' : 'Scan HA'}
        </button>
        {lastScanCompletedAt !== null && !loading && !error && (
          <span className="text-xs text-[var(--green)]">
            Scanned — {candidateCount} candidate{candidateCount === 1 ? '' : 's'} found
          </span>
        )}
      </div>

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
            required
          />
          <EntityPicker
            slot="hp_power"
            label="Power Input"
            value={sensors.power_input || ''}
            onChange={(v) => updateSensor('power_input', v)}
            candidates={candidates.hp_power || []}
            required
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
            <div>
              <EntityPicker
                slot="hp_flow_rate"
                label="Flow rate sensor (optional)"
                value={sensors.flow_rate || ''}
                onChange={(v) => updateSensor('flow_rate', v)}
                candidates={candidates.hp_flow_rate || []}
              />
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Live flow rate (L/min) improves COP calculation. Leave blank if your heat pump does not expose flow rate.
              </p>
            </div>
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
            required
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
        <p className="text-xs text-[var(--text-muted)] mt-1">
          <span className="text-[var(--red)]">*</span> <span>Mandatory</span>
        </p>
      </div>

      <TopicDiscoveryPanel mqtt={mqtt} onResults={setScanResults} />

      {/* Core sensors */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-[var(--text)]">Core Sensors</h3>
        {MQTT_CORE_SENSOR_FIELDS.map(({ key, label, hint, helper }) => (
          <div key={key}>
            <TopicPicker
              label={`${label} (${hint})`}
              value={getInputTopic(key)}
              format={inputs[key]?.format}
              jsonPath={inputs[key]?.json_path}
              onChange={(topic, fmt, jp) => updateInput(key, topic, fmt, jp)}
              scanResults={scanResults}
              required={hint === 'recommended'}
            />
            {helper && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">{helper}</p>
            )}
          </div>
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
            {MQTT_ADDITIONAL_SENSOR_FIELDS.map(({ key, label }) => (
              <TopicPicker
                key={key}
                label={label}
                value={getInputTopic(key)}
                format={inputs[key]?.format}
                jsonPath={inputs[key]?.json_path}
                onChange={(topic, fmt, jp) => updateInput(key, topic, fmt, jp)}
                scanResults={scanResults}
              />
            ))}
          </div>
        )}
      </div>

      {/* Hot Water Signals — OR'd at the driver (see INSTRUCTION-126). */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-[var(--text)]">Hot Water Signals</h3>
        <div>
          <TopicPicker
            label="DHW Active (primary)"
            value={getInputTopic('hot_water_active')}
            format={inputs.hot_water_active?.format}
            jsonPath={inputs.hot_water_active?.json_path}
            onChange={(topic, fmt, jp) => updateInput('hot_water_active', topic, fmt, jp)}
            scanResults={scanResults}
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Writes to <code>mqtt.inputs.hot_water_active</code>. Accepts on / true / 1 / heat /
            high_demand as ON. Live OFF payloads assert the liveness capability;
            unavailable / unknown do not.
          </p>
        </div>
        <div>
          <TopicPicker
            label="DHW Active Boolean (optional OR)"
            value={getInputTopic('hot_water_boolean')}
            format={inputs.hot_water_boolean?.format}
            jsonPath={inputs.hot_water_boolean?.json_path}
            onChange={(topic, fmt, jp) => updateInput('hot_water_boolean', topic, fmt, jp)}
            scanResults={scanResults}
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Writes to <code>mqtt.inputs.hot_water_boolean</code>. OR&apos;d with the primary.
            Either ON ⇒ hot_water_active = True. Same payload semantics as the primary.
          </p>
        </div>
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
              format={inputs.solar_production?.format}
              jsonPath={inputs.solar_production?.json_path}
              onChange={(topic, fmt, jp) => updateInput('solar_production', topic, fmt, jp)}
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
                format={inputs.battery_soc?.format}
                jsonPath={inputs.battery_soc?.json_path}
                onChange={(topic, fmt, jp) => updateInput('battery_soc', topic, fmt, jp)}
                scanResults={scanResults}
              />
              <TopicPicker
                label="Grid Power"
                value={getInputTopic('grid_power')}
                format={inputs.grid_power?.format}
                jsonPath={inputs.grid_power?.json_path}
                onChange={(topic, fmt, jp) => updateInput('grid_power', topic, fmt, jp)}
                scanResults={scanResults}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
