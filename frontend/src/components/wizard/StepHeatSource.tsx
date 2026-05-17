import { useState } from 'react'
import { Flame, Droplets, Fuel, Plus, X, ChevronDown, ChevronUp } from 'lucide-react'
import { cn, formatInterval } from '../../lib/utils'
import { MAX_HEAT_SOURCES } from '../../lib/constants'
import { HelpTip } from '../HelpTip'
import { SOURCE_SELECTION } from '../../lib/helpText'
import type { HeatSourceYaml, MqttTopicInput, QshConfigYaml, SourceSelectionYaml } from '../../types/config'
import { isHeatPumpType } from '../../lib/heat-source-types'
import { TopicPicker } from './TopicPicker'
import { extractTopic, extractFormat, extractJsonPath } from '../../lib/mqttTopic'

type WriteBudgetKey = 'flow_writes_per_hour' | 'mode_writes_per_hour'

interface StepHeatSourceProps {
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

const HEAT_SOURCES = [
  { type: 'heat_pump', label: 'Heat Pump', icon: Droplets, desc: 'Air-source (ASHP)' },
  { type: 'gshp', label: 'Ground Source Heat Pump', icon: Droplets, desc: 'GSHP / brine-loop' },
  { type: 'gas_boiler', label: 'Gas Boiler', icon: Flame, desc: 'Natural gas' },
  { type: 'lpg_boiler', label: 'LPG Boiler', icon: Flame, desc: 'LPG-fired boiler' },
  { type: 'oil_boiler', label: 'Oil Boiler', icon: Fuel, desc: 'Oil-fired boiler' },
] as const

const FLOW_METHODS = [
  { method: 'ha_service', label: 'HA Service Call', desc: 'Standard HA climate service (most common)' },
  { method: 'mqtt', label: 'MQTT', desc: 'Direct MQTT topic control' },
  { method: 'entity', label: 'Entity', desc: 'Write to an input_number entity' },
] as const

// BEIS conversion factors — used as type-aware carbon-factor defaults.
const CARBON_FACTOR_DEFAULTS: Record<HeatSourceYaml['type'], number> = {
  heat_pump: 0.207,
  gshp: 0.207,
  gas_boiler: 0.183,
  lpg_boiler: 0.214,
  oil_boiler: 0.247,
}

const DEFAULT_SS_CONFIG: SourceSelectionYaml = {
  mode: 'auto',
  preference: 0.7,
  min_dwell_minutes: 30,
  score_deadband_pct: 10,
  max_switches_per_day: 6,
}

const DAILY_CAP_MIN = 1
const DAILY_CAP_MAX = 12
const DWELL_MIN = 5
const DWELL_MAX = 240

export function StepHeatSource({ config, onUpdate }: StepHeatSourceProps) {
  // V1 G-3 fix: plural-first read with singular fallback. This branch
  // also handles re-entry into the wizard after the user has already
  // saved a multi-source config — without it, the second visit would
  // start from a wrapped singular and lose source 2.
  const existing: HeatSourceYaml[] =
    (config.heat_sources && config.heat_sources.length > 0)
      ? config.heat_sources
      : (config.heat_source ? [config.heat_source] : [{ type: 'heat_pump', name: 'Source 1' } as HeatSourceYaml])

  const [sources, setSources] = useState<HeatSourceYaml[]>(existing)
  const [expandedIndex, setExpandedIndex] = useState<number>(0)
  const isMqttDriver = config.driver === 'mqtt'

  // React-recommended sync pattern: when the parent's config changes
  // (e.g. wizard back-navigation), re-hydrate local sources from props.
  const incomingKey = JSON.stringify(config.heat_sources ?? config.heat_source ?? null)
  const [lastIncoming, setLastIncoming] = useState<string>(incomingKey)
  if (lastIncoming !== incomingKey) {
    setLastIncoming(incomingKey)
    setSources(existing)
  }

  const writeBack = (next: HeatSourceYaml[]) => {
    setSources(next)
    // Frontend writes ONLY plural — backend reconciles singular per
    // INSTRUCTION-237 cross-cutting decisions (server-authoritative).
    onUpdate('heat_sources', next)
  }

  const updateAt = (i: number, changes: Partial<HeatSourceYaml>) =>
    writeBack(sources.map((s, idx) => (idx === i ? { ...s, ...changes } : s)))

  const addSource = () => {
    if (sources.length >= MAX_HEAT_SOURCES) return
    const next = [...sources, { type: 'heat_pump', name: `Source ${sources.length + 1}` } as HeatSourceYaml]
    writeBack(next)
    setExpandedIndex(next.length - 1)
  }

  const removeAt = (i: number) => {
    if (sources.length <= 1) return
    const next = sources.filter((_, idx) => idx !== i)
    writeBack(next)
    if (expandedIndex >= next.length) {
      setExpandedIndex(Math.max(0, next.length - 1))
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-2">Heat Source</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Configure your heating system(s). Add up to {MAX_HEAT_SOURCES} sources for hybrid installations.
        </p>
      </div>

      {/* Source cards */}
      <div className="space-y-4">
        {sources.map((source, i) => (
          <SourceCard
            key={i}
            source={source}
            index={i}
            isMqttDriver={isMqttDriver}
            removable={sources.length > 1}
            expanded={expandedIndex === i}
            onToggle={() => setExpandedIndex(expandedIndex === i ? -1 : i)}
            onUpdate={(changes) => updateAt(i, changes)}
            onRemove={() => removeAt(i)}
          />
        ))}
      </div>

      {/* Add heat source — bottom (V1 G-1) */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addSource}
          disabled={sources.length >= MAX_HEAT_SOURCES}
          aria-label="Add heat source"
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
            sources.length >= MAX_HEAT_SOURCES
              ? 'border-[var(--border)] text-[var(--text-muted)] cursor-not-allowed'
              : 'border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/5',
          )}
        >
          <Plus size={16} /> Add heat source
        </button>
        {sources.length >= MAX_HEAT_SOURCES && (
          <span className="text-xs text-[var(--text-muted)]">
            Maximum {MAX_HEAT_SOURCES} sources
          </span>
        )}
      </div>

      {/* Source-selection inline editor (only when 2+ sources) */}
      {sources.length >= 2 && (
        <SourceSelectionInlineConfig
          config={config.source_selection ?? DEFAULT_SS_CONFIG}
          sourceNames={sources.map((s, i) => s.name ?? `Source ${i + 1}`)}
          onUpdate={(ss) => onUpdate('source_selection', ss)}
        />
      )}

      {/* Write budget — applies system-wide (cross-source HP controller debouncer) */}
      {sources.length > 0 && (
        <div className="space-y-2 pt-4 border-t border-[var(--border)]">
          <p className="text-xs text-[var(--text-muted)]">
            Cap the rate of writes to the HP controller. Lower if your vendor enforces a flash budget.
          </p>
          <WizardWriteBudgetField
            label="Flow writes per hour"
            fieldKey="flow_writes_per_hour"
            config={config}
            onUpdate={onUpdate}
          />
          <WizardWriteBudgetField
            label="Mode writes per hour"
            fieldKey="mode_writes_per_hour"
            config={config}
            onUpdate={onUpdate}
          />
        </div>
      )}

      {/* MQTT shadow toggle (driver-wide, not per-source) */}
      {isMqttDriver && sources.length > 0 && (
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

interface SourceCardProps {
  source: HeatSourceYaml
  index: number
  isMqttDriver: boolean
  removable: boolean
  expanded: boolean
  onToggle: () => void
  onUpdate: (changes: Partial<HeatSourceYaml>) => void
  onRemove: () => void
}

function SourceCard({
  source,
  index,
  isMqttDriver,
  removable,
  expanded,
  onToggle,
  onUpdate,
  onRemove,
}: SourceCardProps) {
  const hs = source
  const displayName = hs.name ?? `Source ${index + 1}`
  const typeLabel = HEAT_SOURCES.find((t) => t.type === hs.type)?.label ?? hs.type

  const updateFlowControl = (changes: Record<string, unknown>) => {
    const fc = hs.flow_control || {}
    onUpdate({ flow_control: { ...fc, ...changes } })
  }

  const updateOnOff = (changes: Record<string, unknown>) => {
    const oo = hs.on_off_control || {}
    onUpdate({ on_off_control: { ...oo, ...changes } })
  }

  const updatePumpControl = (changes: Record<string, unknown>) => {
    const pc = hs.pump_control || {}
    onUpdate({ pump_control: { ...pc, ...changes } })
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[var(--bg)]">
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? 'Collapse source' : 'Expand source'}
          className="text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text)] truncate">{displayName}</span>
            {hs.type && (
              <span className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)]">
                {typeLabel}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={!removable}
          aria-label={`Remove ${displayName}`}
          className={cn(
            'text-[var(--text-muted)] hover:text-[var(--red)] transition-colors',
            !removable && 'opacity-30 cursor-not-allowed',
          )}
        >
          <X size={18} />
        </button>
      </div>

      {/* Card body */}
      {expanded && (
        <div className="px-4 py-4 space-y-6">
          {/* Source name */}
          <div>
            <label
              htmlFor={`source-${index}-name`}
              className="block text-sm font-medium text-[var(--text)] mb-1"
            >
              Source name
            </label>
            <input
              id={`source-${index}-name`}
              type="text"
              value={hs.name ?? ''}
              onChange={(e) => onUpdate({ name: e.target.value || undefined })}
              placeholder={`Source ${index + 1}`}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
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
                  type="button"
                  onClick={() => onUpdate({ type })}
                  className={cn(
                    'flex flex-col items-center gap-2 p-4 rounded-lg border text-sm transition-colors',
                    hs.type === type
                      ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                      : 'border-[var(--border)] hover:border-[var(--accent)]/50',
                  )}
                >
                  <Icon size={24} className={hs.type === type ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
                  <span className="font-medium">{label}</span>
                  <span className="text-xs text-[var(--text-muted)]">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Efficiency / Min Output */}
          {hs.type && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor={`source-${index}-efficiency`}
                  className="block text-sm font-medium text-[var(--text)] mb-1"
                >
                  {isHeatPumpType(hs.type) ? 'Expected COP' : 'Efficiency'}
                </label>
                <input
                  id={`source-${index}-efficiency`}
                  type="number"
                  step="0.1"
                  value={hs.efficiency ?? (isHeatPumpType(hs.type) ? 3.0 : 0.85)}
                  onChange={(e) => onUpdate({ efficiency: parseFloat(e.target.value) || undefined })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {isHeatPumpType(hs.type) ? 'Typical: 2.5-4.0' : 'Typical: 0.80-0.95'}
                </p>
              </div>
              <div>
                <label
                  htmlFor={`source-${index}-min-output`}
                  className="block text-sm font-medium text-[var(--text)] mb-1"
                >
                  Min Output (kW)
                </label>
                <input
                  id={`source-${index}-min-output`}
                  type="number"
                  step="0.5"
                  value={hs.min_output_kw ?? 2.0}
                  onChange={(e) => onUpdate({ min_output_kw: parseFloat(e.target.value) || undefined })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Minimum compressor/burner output
                </p>
              </div>
            </div>
          )}

          {/* Fuel cost — non-HP sources only */}
          {hs.type && !isHeatPumpType(hs.type) && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor={`source-${index}-fuel-cost`}
                  className="block text-sm font-medium text-[var(--text)] mb-1"
                >
                  Fuel cost (£/kWh)
                </label>
                <input
                  id={`source-${index}-fuel-cost`}
                  type="number"
                  step="0.001"
                  value={hs.fuel_cost_per_kwh ?? ''}
                  onChange={(e) =>
                    onUpdate({
                      fuel_cost_per_kwh:
                        e.target.value === '' ? undefined : parseFloat(e.target.value),
                    })
                  }
                  placeholder="0.060"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              {isMqttDriver ? (
                <div>
                  <div className="text-sm font-medium text-[var(--text)] mb-1 flex items-center gap-1">
                    Fuel cost topic
                    <HelpTip text={SOURCE_SELECTION.fuelCostEntity} size={12} />
                  </div>
                  <TopicPicker
                    value={extractTopic(hs.fuel_cost_entity)}
                    format={extractFormat(hs.fuel_cost_entity)}
                    jsonPath={extractJsonPath(hs.fuel_cost_entity)}
                    onChange={(topic, fmt, jp) => {
                      if (!topic) {
                        onUpdate({ fuel_cost_entity: undefined })
                        return
                      }
                      const entry: MqttTopicInput = {
                        topic,
                        format: (fmt ?? 'plain') as 'plain' | 'json',
                      }
                      if (jp) entry.json_path = jp
                      onUpdate({ fuel_cost_entity: entry })
                    }}
                    placeholder="qsh/sources/boiler/cost"
                    scanResults={[]}
                  />
                </div>
              ) : (
                <div>
                  <label
                    htmlFor={`source-${index}-fuel-cost-entity`}
                    className="text-sm font-medium text-[var(--text)] mb-1 flex items-center gap-1"
                  >
                    Fuel cost entity <HelpTip text={SOURCE_SELECTION.fuelCostEntity} size={12} />
                  </label>
                  <input
                    id={`source-${index}-fuel-cost-entity`}
                    type="text"
                    value={typeof hs.fuel_cost_entity === 'string' ? hs.fuel_cost_entity : ''}
                    onChange={(e) => onUpdate({ fuel_cost_entity: e.target.value || undefined })}
                    placeholder="sensor.gas_unit_rate"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
                  />
                </div>
              )}
            </div>
          )}

          {/* Carbon factor — all source types */}
          {hs.type && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor={`source-${index}-carbon-factor`}
                  className="text-sm font-medium text-[var(--text)] mb-1 flex items-center gap-1"
                >
                  Carbon factor (kgCO₂e/kWh) <HelpTip text={SOURCE_SELECTION.carbonFactor} size={12} />
                </label>
                <input
                  id={`source-${index}-carbon-factor`}
                  type="number"
                  step="0.001"
                  value={hs.carbon_factor ?? CARBON_FACTOR_DEFAULTS[hs.type] ?? 0}
                  onChange={(e) =>
                    onUpdate({
                      carbon_factor: e.target.value === '' ? undefined : parseFloat(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              {isMqttDriver ? (
                <div>
                  <div className="text-sm font-medium text-[var(--text)] mb-1 flex items-center gap-1">
                    Carbon factor topic
                    <HelpTip text={SOURCE_SELECTION.carbonFactor} size={12} />
                  </div>
                  <TopicPicker
                    value={extractTopic(hs.carbon_factor_entity)}
                    format={extractFormat(hs.carbon_factor_entity)}
                    jsonPath={extractJsonPath(hs.carbon_factor_entity)}
                    onChange={(topic, fmt, jp) => {
                      if (!topic) {
                        onUpdate({ carbon_factor_entity: undefined })
                        return
                      }
                      const entry: MqttTopicInput = {
                        topic,
                        format: (fmt ?? 'plain') as 'plain' | 'json',
                      }
                      if (jp) entry.json_path = jp
                      onUpdate({ carbon_factor_entity: entry })
                    }}
                    placeholder="qsh/grid/co2_factor"
                    scanResults={[]}
                  />
                </div>
              ) : (
                <div>
                  <label
                    htmlFor={`source-${index}-carbon-factor-entity`}
                    className="text-sm font-medium text-[var(--text)] mb-1 flex items-center gap-1"
                  >
                    Carbon factor entity <HelpTip text={SOURCE_SELECTION.carbonFactor} size={12} />
                  </label>
                  <input
                    id={`source-${index}-carbon-factor-entity`}
                    type="text"
                    value={typeof hs.carbon_factor_entity === 'string' ? hs.carbon_factor_entity : ''}
                    onChange={(e) => onUpdate({ carbon_factor_entity: e.target.value || undefined })}
                    placeholder="sensor.grid_carbon_intensity"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
                  />
                </div>
              )}
            </div>
          )}

          {/* Rated capacity */}
          {hs.type && (
            <div>
              <label
                htmlFor={`source-${index}-capacity`}
                className="block text-sm font-medium text-[var(--text)] mb-1"
              >
                Rated capacity (kW)
              </label>
              <input
                id={`source-${index}-capacity`}
                type="number"
                min={1}
                max={100}
                step={0.1}
                value={hs.capacity_kw ?? ''}
                onChange={(e) =>
                  onUpdate({
                    capacity_kw: e.target.value === '' ? undefined : parseFloat(e.target.value),
                  })
                }
                placeholder="e.g. 6.0"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {isHeatPumpType(hs.type)
                  ? 'Nameplate electrical input.'
                  : 'Nameplate fuel input.'}
              </p>
              {hs.capacity_kw !== undefined && (hs.capacity_kw < 1 || hs.capacity_kw > 100) && (
                <p className="text-xs text-amber-600 mt-1">
                  Outside typical residential range (1-100 kW). Verify nameplate.
                </p>
              )}
            </div>
          )}

          {/* Flow control method (HA, non-MQTT-driver) */}
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
                        : 'border-[var(--border)] hover:border-[var(--accent)]/50',
                    )}
                  >
                    <input
                      type="radio"
                      name={`flow_method_${index}`}
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

          {/* Pump control — boilers only; HPs drive their own pump */}
          {hs.type && !isHeatPumpType(hs.type) && (
            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-2">
                Pump Control (optional)
              </label>
              <div className="space-y-2">
                <div className="flex gap-4">
                  {(['ha_service', 'mqtt'] as const).map((method) => (
                    <label key={method} className="flex items-center gap-2 text-sm text-[var(--text)]">
                      <input
                        type="radio"
                        name={`pump_method_${index}`}
                        checked={hs.pump_control?.method === method}
                        onChange={() => updatePumpControl({ method })}
                        className="accent-[var(--accent)]"
                      />
                      {method === 'ha_service' ? 'HA Service' : 'MQTT'}
                    </label>
                  ))}
                </div>
                {hs.pump_control?.method === 'mqtt' && (
                  <InputField
                    label="MQTT Topic"
                    value={hs.pump_control?.topic ?? ''}
                    onChange={(v) => updatePumpControl({ topic: v })}
                    placeholder="qsh/pump/speed/set"
                  />
                )}
                {hs.pump_control?.method === 'ha_service' && (
                  <InputField
                    label="Pump Entity"
                    value={hs.pump_control?.entity_id ?? ''}
                    onChange={(v) => updatePumpControl({ entity_id: v })}
                    placeholder="fan.boiler_pump"
                  />
                )}
                <div>
                  <label
                    htmlFor={`source-${index}-pump-max`}
                    className="text-xs text-[var(--text-muted)] mb-1 flex items-center gap-1"
                  >
                    Max pump speed (%) <HelpTip text={SOURCE_SELECTION.pumpMaxSpeed} size={12} />
                  </label>
                  <input
                    id={`source-${index}-pump-max`}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={hs.pump_control?.max_speed_pct ?? 100}
                    onChange={(e) =>
                      updatePumpControl({
                        max_speed_pct: e.target.value === '' ? 100 : parseInt(e.target.value, 10),
                      })
                    }
                    className="w-32 px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Flow temp range */}
          {hs.type && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor={`source-${index}-flow-min`}
                  className="block text-sm font-medium text-[var(--text)] mb-1"
                >
                  Min Flow Temp
                </label>
                <input
                  id={`source-${index}-flow-min`}
                  type="number"
                  value={hs.flow_min ?? 25}
                  onChange={(e) => onUpdate({ flow_min: parseFloat(e.target.value) || 25 })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label
                  htmlFor={`source-${index}-flow-max`}
                  className="block text-sm font-medium text-[var(--text)] mb-1"
                >
                  Max Flow Temp
                </label>
                <input
                  id={`source-${index}-flow-max`}
                  type="number"
                  value={hs.flow_max ?? 55}
                  onChange={(e) => onUpdate({ flow_max: parseFloat(e.target.value) || 55 })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface SourceSelectionInlineConfigProps {
  config: SourceSelectionYaml
  sourceNames: string[]
  onUpdate: (ss: SourceSelectionYaml) => void
}

function SourceSelectionInlineConfig({ config, sourceNames, onUpdate }: SourceSelectionInlineConfigProps) {
  const [ss, setSs] = useState<SourceSelectionYaml>(config)

  // Re-sync if upstream changes (config hydration on back-nav).
  const incomingKey = JSON.stringify(config)
  const [lastIncoming, setLastIncoming] = useState<string>(incomingKey)
  if (lastIncoming !== incomingKey) {
    setLastIncoming(incomingKey)
    setSs(config)
  }

  const update = (changes: Partial<SourceSelectionYaml>) => {
    const next = { ...ss, ...changes }
    setSs(next)
    onUpdate(next)
  }

  // V1 G-4: deduplicate colliding source names in the dropdown so the user
  // can still target a specific card. Append " (2)" / " (3)" etc. to repeats.
  const seen = new Map<string, number>()
  const displayedNames: string[] = sourceNames.map((name) => {
    const prev = seen.get(name) ?? 0
    seen.set(name, prev + 1)
    return prev === 0 ? name : `${name} (${prev + 1})`
  })

  const preferencePct = Math.round(ss.preference * 100)

  return (
    <div className="space-y-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <div>
        <h3 className="text-sm font-bold text-[var(--text)] mb-1">Source Selection</h3>
        <p className="text-xs text-[var(--text-muted)]">
          With two or more sources, QSH picks the active source each cycle. Auto mode chooses based on your cost/eco preference; manual modes lock to one source.
        </p>
      </div>

      <div>
        <label
          htmlFor="ss-mode"
          className="text-sm font-medium text-[var(--text)] mb-1 flex items-center gap-1"
        >
          Default mode <HelpTip text={SOURCE_SELECTION.mode} size={12} />
        </label>
        <select
          id="ss-mode"
          value={ss.mode}
          onChange={(e) => update({ mode: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
        >
          <option value="auto">Auto (cheapest / greenest per cycle)</option>
          {displayedNames.map((displayed, i) => (
            <option key={i} value={sourceNames[i]}>
              Lock to {displayed}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="ss-preference"
          className="text-sm font-medium text-[var(--text)] mb-1 flex items-center gap-1"
        >
          Cost / Eco preference <HelpTip text={SOURCE_SELECTION.preference} size={12} />
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">Cost</span>
          <input
            id="ss-preference"
            type="range"
            min={0}
            max={100}
            step={5}
            value={preferencePct}
            onChange={(e) => update({ preference: parseInt(e.target.value, 10) / 100 })}
            className="flex-1 accent-[var(--accent)]"
          />
          <span className="text-xs text-[var(--text-muted)]">Eco</span>
        </div>
        <div className="text-xs text-[var(--text-muted)] mt-1 text-center">{preferencePct}%</div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="ss-dwell"
            className="text-sm font-medium text-[var(--text)] mb-1 flex items-center gap-1"
          >
            Min dwell (min) <HelpTip text={SOURCE_SELECTION.dwell} size={12} />
          </label>
          <input
            id="ss-dwell"
            type="number"
            min={DWELL_MIN}
            max={DWELL_MAX}
            value={ss.min_dwell_minutes}
            onChange={(e) => {
              const raw = parseInt(e.target.value, 10)
              const next = Number.isFinite(raw)
                ? Math.max(DWELL_MIN, Math.min(DWELL_MAX, raw))
                : 30
              update({ min_dwell_minutes: next })
            }}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
        </div>
        <div>
          <label
            htmlFor="ss-max-switches"
            className="text-sm font-medium text-[var(--text)] mb-1 flex items-center gap-1"
          >
            Max switches / day <HelpTip text={SOURCE_SELECTION.maxSwitches} size={12} />
          </label>
          <input
            id="ss-max-switches"
            type="number"
            min={DAILY_CAP_MIN}
            max={DAILY_CAP_MAX}
            value={ss.max_switches_per_day}
            onChange={(e) => {
              const raw = parseInt(e.target.value, 10)
              const next = Number.isFinite(raw)
                ? Math.max(DAILY_CAP_MIN, Math.min(DAILY_CAP_MAX, raw))
                : 6
              update({ max_switches_per_day: next })
            }}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
          />
        </div>
      </div>
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

interface WizardWriteBudgetFieldProps {
  label: string
  fieldKey: WriteBudgetKey
  config: Partial<QshConfigYaml>
  onUpdate: (section: string, data: unknown) => void
}

function WizardWriteBudgetField({
  label,
  fieldKey,
  config,
  onUpdate,
}: WizardWriteBudgetFieldProps) {
  const committed = config[fieldKey] ?? 6
  const [value, setValue] = useState<number>(committed)
  const [error, setError] = useState<string | null>(null)
  // React-recommended pattern for syncing local state with a prop that may
  // change externally (user navigated back). Setting state during render is
  // OK when guarded by a previous-value comparison — React bails out fast.
  const [lastCommitted, setLastCommitted] = useState<number>(committed)
  if (lastCommitted !== committed) {
    setLastCommitted(committed)
    setValue(committed)
  }

  const isValid = (v: number): boolean =>
    Number.isInteger(v) && v >= 3 && v <= 6

  const clamp = (v: number): number => {
    if (!Number.isFinite(v)) return 6
    return Math.max(3, Math.min(6, Math.round(v)))
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <label className="text-sm text-[var(--text)] min-w-[10rem]" htmlFor={`wizard-${fieldKey}`}>
          {label}
        </label>
        <input
          id={`wizard-${fieldKey}`}
          type="number"
          min={3}
          max={6}
          step={1}
          value={value}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              return
            }
            const v = Number(raw)
            if (Number.isNaN(v)) {
              return
            }
            if (isValid(v)) {
              setError(null)
              setValue(v)
              onUpdate(fieldKey, v)
            } else if (Number.isInteger(v)) {
              setError('Must be 3–6')
              setValue(v)
            } else {
              setError('Must be 3–6')
            }
          }}
          onBlur={() => {
            const clamped = clamp(value)
            if (clamped !== value) {
              setValue(clamped)
            }
            if (isValid(clamped)) {
              setError(null)
            }
            if (clamped !== (config[fieldKey] ?? 6)) {
              onUpdate(fieldKey, clamped)
            }
          }}
          className={cn(
            'w-20 px-2 py-1 rounded border bg-[var(--bg)] text-sm text-[var(--text)]',
            error ? 'border-red-500' : 'border-[var(--border)]',
          )}
        />
        <span className="text-xs text-[var(--text-muted)]">
          ≈ one update every {formatInterval(3600 / clamp(value))}
        </span>
      </div>
      {error && <span className="text-xs text-red-600 pl-[10.75rem]">{error}</span>}
    </div>
  )
}
