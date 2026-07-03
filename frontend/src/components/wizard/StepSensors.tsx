import { useState } from 'react'
import { Search, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { EntityPicker } from './EntityPicker'
import { TopicPicker } from './TopicPicker'
import { TopicDiscoveryPanel } from './TopicDiscoveryPanel'
import { useEntityScan } from '../../hooks/useEntityScan'
import { cn } from '../../lib/utils'
import { mqttSensorPlaceholder } from '../../lib/mqtt-placeholders'
import { asTopicInput } from '../../lib/mqttTopic'
import type {
  HeatSourceYaml, OutdoorYaml, SolarYaml, BatteryYaml, GridYaml,
  MqttConfig, MqttTopicInput, MqttTopicCandidate,
} from '../../types/config'

interface StepSensorsProps {
  config: Record<string, unknown>
  onUpdate: (section: string, data: unknown) => void
}

// Core sensors — always visible in the wizard flow. INSTRUCTION-241B V2:
// reduced to globals only; the per-source HP/boiler entries moved to
// PER_SOURCE_MQTT_SENSOR_FIELDS and render under the tab strip.
const MQTT_CORE_SENSOR_FIELDS = [
  { key: 'outdoor_temp', label: 'Outdoor Temperature', hint: 'recommended', helper: '' },
  { key: 'forecast', label: 'Weather Forecast Topic', hint: 'optional', helper: 'Required when forecast_extension_master_enable is true. Subscribed at {topic_prefix}/<this value>.' },
] as const

// Additional sensors — collapsed by default. INSTRUCTION-241B V2:
// hp_mode_state is system-level (parent §D-8); the other former entries
// moved to PER_SOURCE_MQTT_SENSOR_FIELDS.
const MQTT_ADDITIONAL_SENSOR_FIELDS = [
  { key: 'hp_mode_state', label: 'HP Mode State', hint: 'optional', helper: '' },
  // INSTRUCTION-364 — optional cooling-status topic. Truthy ⇒ pauses SysID
  // learning while the HP runs as cooling (OR-composed with hydraulic detection).
  { key: 'cooling_active', label: 'Cooling Status', hint: 'optional', helper: '' },
] as const

// Per-source sensor topics — rendered under the tab strip in MqttSensors.
// Each entry maps to `heat_sources[i].sensors[key]` as a MqttTopicInput object.
const PER_SOURCE_MQTT_SENSOR_FIELDS = [
  { key: 'flow_temp',    label: 'Flow Temperature',  hint: 'recommended', helperFor: '' },
  { key: 'return_temp',  label: 'Return Temperature', hint: 'optional',   helperFor: '' },
  {
    key: 'flow_rate',
    label: 'Flow rate sensor',
    hint: 'optional',
    helperFor:
      'Live flow rate (L/min) improves COP calculation. Leave blank if this source does not expose flow rate.',
  },
  { key: 'power_input',  label: 'Power Input',  hint: 'recommended', helperFor: '' },
  { key: 'cop',          label: 'COP',          hint: 'optional',    helperFor: '' },
  { key: 'heat_output',  label: 'Heat Output',  hint: 'optional',    helperFor: '' },
  { key: 'total_energy', label: 'Total Energy', hint: 'optional',    helperFor: '' },
  { key: 'delta_t',      label: 'Delta-T',      hint: 'optional',    helperFor: '' },
  {
    key: 'pump_power',
    label: 'Pump power',
    hint: 'optional',
    helperFor:
      'Circulator pump electrical input — typically relevant only for boiler sources.',
  },
] as const

export function StepSensors({ config, onUpdate }: StepSensorsProps) {
  const isMqtt = config.driver === 'mqtt'

  if (isMqtt) {
    return <MqttSensors config={config} onUpdate={onUpdate} />
  }
  return <HaSensors config={config} onUpdate={onUpdate} />
}

/** Narrowing helper: HA-side sensor slots store string entity IDs; the
 * union with `MqttTopicInput` exists only so the MQTT path can store
 * topic objects in the same field. HA components never see objects in
 * practice — this helper preserves type safety without an `as` cast. */
function sensorAsString(v: string | { topic: string } | undefined): string {
  return typeof v === 'string' ? v : ''
}

/** HA path — supports per-source sensor tabs (INSTRUCTION-237A Task 5). */
function HaSensors({ config, onUpdate }: StepSensorsProps) {
  const { candidates, loading, error, scan } = useEntityScan()
  // Plural-first read with singular fallback (V1 G-3 fix). Wizard re-entry
  // after a multi-source save must hydrate from heat_sources, not from a
  // stale wrapped singular.
  const heatSourcesArr: HeatSourceYaml[] = Array.isArray(config.heat_sources)
    ? (config.heat_sources as HeatSourceYaml[])
    : (config.heat_source ? [config.heat_source as HeatSourceYaml] : [])
  const [activeTab, setActiveTab] = useState<number>(0)
  const safeActive = Math.min(activeTab, Math.max(0, heatSourcesArr.length - 1))
  const hs: HeatSourceYaml = heatSourcesArr[safeActive] ?? ({} as HeatSourceYaml)
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
  // INSTRUCTION-394 — grid is independent of battery. A meter-only install can
  // wire the grid sensor without claiming a battery.
  const [hasGrid, setHasGrid] = useState(
    !!(config.grid as GridYaml | undefined)?.power_entity
  )

  const updateSensor = (key: string, value: string) => {
    const newSensors = { ...sensors, [key]: value || undefined }
    // INSTRUCTION-237A: writes plural only. Server reconciles to singular
    // on save when length === 1.
    const updatedSource = { ...hs, sensors: newSensors }
    const nextSources =
      heatSourcesArr.length > 0
        ? heatSourcesArr.map((s, i) => (i === safeActive ? updatedSource : s))
        : [updatedSource]
    onUpdate('heat_sources', nextSources)
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
      // INSTRUCTION-394 — battery "No" no longer clears grid; grid is independent.
      onUpdate('battery', undefined)
    }
  }

  const toggleGrid = (enabled: boolean) => {
    setHasGrid(enabled)
    if (!enabled) {
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

      {error && (
        <div
          role="alert"
          className="mb-4 px-4 py-3 rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 text-sm text-[var(--text)]"
        >
          <div className="font-medium text-[var(--red)] mb-1">Entity scan failed</div>
          <div className="text-[var(--text-muted)]">
            {error}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-2">
            Check that the QSH add-on has the Supervisor token, and retry. You can
            also paste entity IDs directly into any picker below — the wizard
            accepts pasted IDs even when scanning is unavailable.
          </div>
          <button
            onClick={() => scan()}
            className="mt-2 px-3 py-1 text-xs rounded bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]/50 transition-colors"
          >
            Retry scan
          </button>
        </div>
      )}

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

      {/* Per-source tab strip (INSTRUCTION-237A Task 5) — only renders when
          two or more sources are configured. Below, the sensor mapping
          operates on heat_sources[activeTab].sensors. */}
      {heatSourcesArr.length >= 2 && (
        <div
          role="tablist"
          aria-label="Heat source sensors tabs"
          className="flex gap-2 border-b border-[var(--border)]"
        >
          {heatSourcesArr.map((src, i) => {
            const tabLabel = src.name ?? src.type ?? `Source ${i + 1}`
            const isActive = i === safeActive
            return (
              <button
                key={i}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(i)}
                className={cn(
                  'px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors',
                  isActive
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
                )}
              >
                {tabLabel}
              </button>
            )
          })}
        </div>
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
            value={sensorAsString(sensors.flow_temp)}
            onChange={(v) => updateSensor('flow_temp', v)}
            candidates={candidates.hp_flow_temp || []}
            required
          />
          <EntityPicker
            slot="hp_power"
            label="Power Input"
            value={sensorAsString(sensors.power_input)}
            onChange={(v) => updateSensor('power_input', v)}
            candidates={candidates.hp_power || []}
            required
          />
          <EntityPicker
            slot="hp_cop"
            label="COP Sensor"
            value={sensorAsString(sensors.cop)}
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
              value={sensorAsString(sensors.heat_output)}
              onChange={(v) => updateSensor('heat_output', v)}
              candidates={candidates.hp_heat_output || []}
            />
            <EntityPicker
              slot="hp_total_energy"
              label="Total Energy"
              value={sensorAsString(sensors.total_energy)}
              onChange={(v) => updateSensor('total_energy', v)}
              candidates={candidates.hp_total_energy || []}
            />
            <div className="grid grid-cols-2 gap-4">
              <EntityPicker
                slot="hp_return_temp"
                label="Return Temperature"
                value={sensorAsString(sensors.return_temp)}
                onChange={(v) => updateSensor('return_temp', v)}
                candidates={candidates.hp_return_temp || []}
              />
              <EntityPicker
                slot="hp_delta_t"
                label="Delta-T"
                value={sensorAsString(sensors.delta_t)}
                onChange={(v) => updateSensor('delta_t', v)}
                candidates={[]}
              />
            </div>
            <div>
              <EntityPicker
                slot="hp_flow_rate"
                label="Flow rate sensor (optional)"
                value={sensorAsString(sensors.flow_rate)}
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
              value={sensorAsString(sensors.water_heater)}
              onChange={(v) => updateSensor('water_heater', v)}
              candidates={candidates.hp_water_heater || []}
            />
            <div>
              <EntityPicker
                slot="hp_cooling_active"
                label="Cooling Status"
                value={sensorAsString(sensors.cooling_active)}
                onChange={(v) => updateSensor('cooling_active', v)}
                candidates={[]}
              />
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Optional binary/mode entity that reads true when the HP is cooling — pauses SysID learning while active.
              </p>
            </div>
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

      {/* Solar, Battery & Grid */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-[var(--text)]">
          Solar, Battery & Grid (optional)
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
            </div>
          )}
        </div>

        {/* Grid toggle — INSTRUCTION-394: standalone, independent of battery. */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--text)]">Do you monitor grid import/export?</span>
            <div className="flex gap-2">
              <button
                onClick={() => toggleGrid(true)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  hasGrid
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                Yes
              </button>
              <button
                onClick={() => toggleGrid(false)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  !hasGrid
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                No
              </button>
            </div>
          </div>
          {hasGrid && (
            <EntityPicker
              slot="grid_power"
              label="Grid Power"
              value={(config.grid as GridYaml | undefined)?.power_entity || ''}
              onChange={(v) =>
                onUpdate('grid', { ...(config.grid as object || {}), power_entity: v || undefined })
              }
              candidates={candidates.grid_power || []}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** MQTT path — TopicPicker for each sensor field. INSTRUCTION-241B adds a
 * per-source tab strip mirroring the HA path. */
function MqttSensors({ config, onUpdate }: StepSensorsProps) {
  const mqtt: MqttConfig = (config.mqtt as MqttConfig) || { broker: '', port: 1883, inputs: {} }
  const inputs = mqtt.inputs || {}
  const [scanResults, setScanResults] = useState<MqttTopicCandidate[]>([])
  const [showAdditional, setShowAdditional] = useState(false)

  // INSTRUCTION-241B Task 1 — per-source state for the tab strip. Plural-first
  // read with singular fallback for the wizard's mid-edit state (before the
  // singular→plural promotion has happened in this draft).
  const heatSourcesArr: HeatSourceYaml[] = Array.isArray(config.heat_sources)
    ? (config.heat_sources as HeatSourceYaml[])
    : (config.heat_source ? [config.heat_source as HeatSourceYaml] : [])
  const [activeTab, setActiveTab] = useState<number>(0)
  const safeActive = Math.min(activeTab, Math.max(0, heatSourcesArr.length - 1))
  const hs: HeatSourceYaml = heatSourcesArr[safeActive] ?? ({} as HeatSourceYaml)
  const perSourceSensors = hs.sensors || {}

  const [hasSolar, setHasSolar] = useState(!!inputs.solar_production?.topic)
  const [hasBattery, setHasBattery] = useState(!!inputs.battery_soc?.topic)
  // INSTRUCTION-394 — grid independent of battery, initialised from the canonical
  // mqtt.inputs map.
  const [hasGrid, setHasGrid] = useState(!!inputs.grid_power?.topic)

  // INSTRUCTION-394 F-394-2 — clear a legacy section topic key alongside the
  // canonical key on a "No" answer, so a pre-R1 YAML's residue cannot be
  // re-migrated by INSTRUCTION-393's shim at next load (a disabled input can no
  // longer silently re-enable). Post-R1 configs carry no legacy keys, so this is
  // a defensive no-op on them.
  const clearLegacySectionTopic = (section: 'solar' | 'battery' | 'grid', key: string) => {
    const current = config[section] as Record<string, unknown> | undefined
    if (current && key in current) {
      const next = { ...current }
      delete next[key]
      onUpdate(section, Object.keys(next).length > 0 ? next : undefined)
    }
  }

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

  // INSTRUCTION-241B Task 1 — writes heat_sources[safeActive].sensors[key].
  // F5(b) no-double-write invariant: this helper is the ONLY path the wizard
  // uses to write heat-source sensor topics; `updateInput` continues to write
  // mqtt.inputs[key] only for globals.
  const updatePerSourceSensor = (
    key: string,
    topic: string,
    format?: string,
    jsonPath?: string,
  ) => {
    const nextEntry: MqttTopicInput | undefined = topic
      ? {
          topic,
          format: (format || 'plain') as 'plain' | 'json',
          ...(jsonPath ? { json_path: jsonPath } : {}),
        }
      : undefined
    const nextSensors: Record<string, MqttTopicInput | string | undefined> = { ...perSourceSensors }
    if (nextEntry) {
      nextSensors[key] = nextEntry
    } else {
      delete nextSensors[key]
    }
    const updatedSource = { ...hs, sensors: nextSensors }
    const nextSources =
      heatSourcesArr.length > 0
        ? heatSourcesArr.map((s, i) => (i === safeActive ? updatedSource : s))
        : [updatedSource]
    onUpdate('heat_sources', nextSources)
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

      {/* INSTRUCTION-241B Task 2 — per-source tab strip. Mirrors the HA path's
          tab strip at 237A Task 5. Renders only when 2+ sources are configured. */}
      {heatSourcesArr.length >= 2 && (
        <div
          role="tablist"
          aria-label="Heat source sensors tabs (MQTT)"
          className="flex gap-2 border-b border-[var(--border)]"
        >
          {heatSourcesArr.map((src, i) => {
            const tabLabel = src.name ?? src.type ?? `Source ${i + 1}`
            const isActive = i === safeActive
            return (
              <button
                key={i}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(i)}
                className={cn(
                  'px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors',
                  isActive
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
                )}
              >
                {tabLabel}
              </button>
            )
          })}
        </div>
      )}

      {/* Core sensors — globals only (outdoor_temp). Per-source HP/boiler
          entries moved to the per-source block below. */}
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

      {/* INSTRUCTION-241B Task 3 — per-source sensor topic pickers.
          Each picker writes heat_sources[safeActive].sensors[key]. */}
      <div>
        <h3 className="text-sm font-medium text-[var(--text)] mb-3">
          Heat Source Sensors
          {heatSourcesArr.length >= 2 && (
            <span className="ml-2 text-xs text-[var(--text-muted)]">
              — editing source {safeActive + 1} of {heatSourcesArr.length}
            </span>
          )}
        </h3>
        <div className="space-y-4">
          {PER_SOURCE_MQTT_SENSOR_FIELDS.map(({ key, label, hint, helperFor }) => {
            const entry = asTopicInput(perSourceSensors[key as keyof typeof perSourceSensors])
            return (
              <div key={key}>
                <TopicPicker
                  label={`${label} (${hint})`}
                  value={entry?.topic ?? ''}
                  format={entry?.format}
                  jsonPath={entry?.json_path}
                  onChange={(topic, fmt, jp) => updatePerSourceSensor(key, topic, fmt, jp)}
                  scanResults={scanResults}
                  placeholder={mqttSensorPlaceholder(
                    heatSourcesArr, safeActive, key, { singleSource: true },
                  )}
                  required={hint === 'recommended'}
                />
                {helperFor && (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{helperFor}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Additional sensors — system-level only (hp_mode_state per §D-8). */}
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

      {/* Solar, Battery & Grid */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-[var(--text)]">Solar, Battery & Grid (optional)</h3>

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
                onClick={() => { setHasSolar(false); updateInput('solar_production', ''); clearLegacySectionTopic('solar', 'production_topic') }}
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
                onClick={() => { setHasBattery(false); updateInput('battery_soc', ''); clearLegacySectionTopic('battery', 'soc_topic') }}
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
            </div>
          )}
        </div>

        {/* Grid question — INSTRUCTION-394: standalone, independent of battery. */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--text)]">Do you monitor grid import/export?</span>
            <div className="flex gap-2">
              <button
                onClick={() => setHasGrid(true)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  hasGrid
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                Yes
              </button>
              <button
                onClick={() => { setHasGrid(false); updateInput('grid_power', ''); clearLegacySectionTopic('grid', 'power_topic') }}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  !hasGrid
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                No
              </button>
            </div>
          </div>
          {hasGrid && (
            <TopicPicker
              label="Grid Power"
              value={getInputTopic('grid_power')}
              format={inputs.grid_power?.format}
              jsonPath={inputs.grid_power?.json_path}
              onChange={(topic, fmt, jp) => updateInput('grid_power', topic, fmt, jp)}
              scanResults={scanResults}
            />
          )}
        </div>
      </div>
    </div>
  )
}
