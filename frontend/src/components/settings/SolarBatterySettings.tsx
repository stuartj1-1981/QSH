import { useState, useEffect, useMemo } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { patchOrDelete } from '../../hooks/useConfig'
import { useEntityResolve } from '../../hooks/useEntityResolve'
import { useSysid } from '../../hooks/useSysid'
import { EntityField } from './EntityField'
import { TopicField } from './TopicField'
import { HelpTip } from '../HelpTip'
import { SOLAR } from '../../lib/helpText'
import { apiUrl } from '../../lib/api'
import type {
  SolarYaml, BatteryYaml, GridYaml, InverterYaml, MqttConfig, MqttTopicInput, Driver,
} from '../../types/config'

// INSTRUCTION-227C — keep aligned with SOLAR_CAPACITY_MIN_OBS in qsh/sysid.py.
const SOLAR_CAPACITY_MIN_OBS = 50

// INSTRUCTION-394 — canonical mqtt.inputs entries are either a plain string
// (topic) or a dict {topic, format, json_path?}. Extract the topic uniformly.
// Typed to accept both runtime shapes: the type declares MqttTopicInput but
// INSTRUCTION-393's shim writes plain strings, so a legacy-migrated install can
// present a string here.
function topicOf(v: MqttTopicInput | string | undefined): string {
  return typeof v === 'string' ? v : v?.topic ?? ''
}

const sectionNonEmpty = (s?: object): boolean => !!s && Object.keys(s).length > 0

interface SolarBatterySettingsProps {
  solar?: SolarYaml
  battery?: BatteryYaml
  grid?: GridYaml
  inverter?: InverterYaml
  mqtt?: MqttConfig
  driver: Driver
  onRefetch: () => void
}

export function SolarBatterySettings({
  solar: initialSolar,
  battery: initialBattery,
  grid: initialGrid,
  inverter: initialInverter,
  mqtt,
  driver,
  onRefetch,
}: SolarBatterySettingsProps) {
  const [hasSolar, setHasSolar] = useState(
    driver === 'mqtt'
      ? topicOf(mqtt?.inputs?.solar_production) !== '' || sectionNonEmpty(initialSolar)
      : !!initialSolar?.production_entity
  )
  const [hasBattery, setHasBattery] = useState(
    driver === 'mqtt'
      ? topicOf(mqtt?.inputs?.battery_soc) !== '' || sectionNonEmpty(initialBattery)
      : !!initialBattery?.soc_entity
  )
  // INSTRUCTION-394 F-394-1 — content-based grid predicate. hasGrid is true iff
  // there is any persisted grid configuration: on MQTT the canonical topic OR a
  // grid section (voltage-only counts); on HA a grid section (power_entity or
  // voltages). Decoupled from hasBattery entirely.
  const [hasGrid, setHasGrid] = useState(
    driver === 'mqtt'
      ? topicOf(mqtt?.inputs?.grid_power) !== '' || sectionNonEmpty(initialGrid)
      : sectionNonEmpty(initialGrid)
  )

  const [solar, setSolar] = useState<SolarYaml>(initialSolar || {})
  const [battery, setBattery] = useState<BatteryYaml>(initialBattery || {})
  const [grid, setGrid] = useState<GridYaml>(initialGrid || {})
  const [inverter, setInverter] = useState<InverterYaml>(initialInverter || {})

  // INSTRUCTION-394 — MQTT topic fields are single-writer against the canonical
  // mqtt.inputs.* map (OutdoorWeatherSettings.tsx:25-26/:53-60 pattern).
  const [mqttSolarTopic, setMqttSolarTopic] = useState(topicOf(mqtt?.inputs?.solar_production))
  const [mqttBatteryTopic, setMqttBatteryTopic] = useState(topicOf(mqtt?.inputs?.battery_soc))
  const [mqttGridTopic, setMqttGridTopic] = useState(topicOf(mqtt?.inputs?.grid_power))

  useEffect(() => {
    setSolar(initialSolar || {})
  }, [initialSolar])
  useEffect(() => {
    setBattery(initialBattery || {})
  }, [initialBattery])
  useEffect(() => {
    setGrid(initialGrid || {})
  }, [initialGrid])
  useEffect(() => {
    setInverter(initialInverter || {})
  }, [initialInverter])
  useEffect(() => {
    setMqttSolarTopic(topicOf(mqtt?.inputs?.solar_production))
    setMqttBatteryTopic(topicOf(mqtt?.inputs?.battery_soc))
    setMqttGridTopic(topicOf(mqtt?.inputs?.grid_power))
  }, [mqtt])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const entityIds = useMemo(
    () =>
      driver === 'mqtt'
        ? []
        : [solar.production_entity, battery.soc_entity, grid.power_entity].filter(
            Boolean
          ) as string[],
    [solar.production_entity, battery.soc_entity, grid.power_entity, driver]
  )
  const { resolved } = useEntityResolve(entityIds)

  // INSTRUCTION-227C Task 6 — installation kWp from sysid observer (227B).
  // Surfaced read-only with maturity suffix when learning is in flight.
  const { data: sysidData } = useSysid()
  const capacity = sysidData?.installation_solar_capacity_kw ?? null

  // INSTRUCTION-394 — strip legacy MQTT topic keys from a section before save so
  // no code path re-writes solar.production_topic / battery.soc_topic /
  // grid.power_topic (D-1/R1 single writer). Sections keep non-topic config only.
  const stripLegacyTopic = <T extends object>(section: T, key: string): T => {
    const next = { ...section } as Record<string, unknown>
    delete next[key]
    return next as T
  }

  const save = async () => {
    setSaving(true)
    setError(null)

    const failures: string[] = []

    // INSTRUCTION-394 — MQTT single-writer: PATCH the full mqtt object with only
    // the relevant inputs keys mutated, spreading ...mqtt / ...mqtt.inputs to
    // preserve broker credentials and unrelated inputs. restore_redacted handles
    // the credential sentinel server-side (config.py:213-226).
    if (driver === 'mqtt') {
      try {
        const buildEntry = (
          existing: MqttTopicInput | string | undefined,
          topic: string,
          enabled: boolean
        ): MqttTopicInput | string | undefined => {
          if (!enabled || !topic) return undefined
          // Editing an existing dict-form entry preserves format/json_path;
          // creating a new entry writes a plain string (topic_map.py:706-708).
          if (existing && typeof existing === 'object') return { ...existing, topic }
          return topic
        }
        const newInputs: Record<string, MqttTopicInput | string> = {
          ...(mqtt?.inputs as Record<string, MqttTopicInput | string> | undefined),
        }
        const apply = (key: string, entry: MqttTopicInput | string | undefined) => {
          if (entry === undefined) delete newInputs[key]
          else newInputs[key] = entry
        }
        apply('solar_production', buildEntry(mqtt?.inputs?.solar_production, mqttSolarTopic, hasSolar))
        apply('battery_soc', buildEntry(mqtt?.inputs?.battery_soc, mqttBatteryTopic, hasBattery))
        apply('grid_power', buildEntry(mqtt?.inputs?.grid_power, mqttGridTopic, hasGrid))
        const updatedMqtt = { ...mqtt, inputs: newInputs }
        const resp = await fetch(apiUrl('api/config/mqtt'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: updatedMqtt }),
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      } catch {
        failures.push('mqtt')
      }
    }

    // Section config (non-topic only). Grid persists/deletes on its own hasGrid
    // checkbox — decoupled from hasBattery.
    const sections: Array<{ name: string; fn: () => Promise<unknown> }> = [
      { name: 'solar', fn: () => patchOrDelete('solar', hasSolar, stripLegacyTopic(solar, 'production_topic')) },
      { name: 'battery', fn: () => patchOrDelete('battery', hasBattery, stripLegacyTopic(battery, 'soc_topic')) },
      { name: 'grid', fn: () => patchOrDelete('grid', hasGrid, stripLegacyTopic(grid, 'power_topic')) },
      { name: 'inverter', fn: () => patchOrDelete('inverter', hasSolar, inverter) },
    ]
    for (const { name, fn } of sections) {
      try { await fn() } catch { failures.push(name) }
    }
    if (failures.length > 0) {
      setError(`Failed to save: ${failures.join(', ')}. Please retry.`)
    } else {
      onRefetch()
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text)]">Solar & Battery</h2>
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
        <div className="p-3 rounded-lg bg-[var(--red)]/10 text-[var(--red)] text-sm">
          {error}
        </div>
      )}

      {/* Solar */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hasSolar}
            onChange={(e) => setHasSolar(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          <span className="text-sm font-medium text-[var(--text)]">I have solar panels</span>
        </label>

        {hasSolar && (
          <div className="space-y-4 pl-4 border-l-2 border-[var(--border)]">
            {/* INSTRUCTION-227C Task 6 — observed installation kWp from sysid. */}
            <div
              className="flex items-center justify-between py-2 border-b border-[var(--border)]"
              data-testid="solar-observed-capacity-row"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-sm">Solar production capacity (observed)</span>
                <HelpTip
                  size={12}
                  text="The system tracks the highest solar production it has observed and uses that as the installation's effective peak capacity (kWp) when projecting future heating effects of solar gain. This value updates as more sunny periods accumulate. No manual override is offered — to reset, edit sysid_state.json."
                />
              </div>
              <div className="text-right">
                {capacity?.value == null ? (
                  <span className="text-[var(--text-muted)]">—</span>
                ) : (
                  <>
                    <span className="font-medium">{capacity.value.toFixed(1)} kW</span>
                    {!capacity.mature && (
                      <span className="text-xs text-[var(--text-muted)] ml-2">
                        (learning — {capacity.observations}/{SOLAR_CAPACITY_MIN_OBS})
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            {driver === 'ha' ? (
              <EntityField
                label="Solar Production Entity"
                value={solar.production_entity || ''}
                friendlyName={resolved[solar.production_entity || '']?.friendly_name}
                state={resolved[solar.production_entity || '']?.state}
                unit={resolved[solar.production_entity || '']?.unit}
                onChange={(v) => setSolar(prev => ({ ...prev, production_entity: v || undefined }))}
                placeholder="sensor.solar_power"
                helpText={SOLAR.solarEntity}
              />
            ) : (
              <TopicField
                label="Solar Production Topic"
                value={mqttSolarTopic}
                onChange={setMqttSolarTopic}
                placeholder="solar/production_w"
                helpText={SOLAR.solarEntity}
              />
            )}

            <div>
              <label className="block text-xs font-medium text-[var(--text)] mb-1">
                Inverter Fallback Efficiency (0.8–1.0)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.8"
                max="1.0"
                value={inverter.fallback_efficiency ?? 0.97}
                onChange={(e) =>
                  setInverter(prev => ({ ...prev, fallback_efficiency: parseFloat(e.target.value) || 0.97 }))
                }
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
              />
            </div>
          </div>
        )}
      </div>

      {/* Battery */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hasBattery}
            onChange={(e) => setHasBattery(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          <span className="text-sm font-medium text-[var(--text)]">I have a home battery</span>
        </label>

        {hasBattery && (
          <div className="space-y-4 pl-4 border-l-2 border-[var(--border)]">
            {driver === 'ha' ? (
              <EntityField
                label="Battery SoC Entity"
                value={battery.soc_entity || ''}
                friendlyName={resolved[battery.soc_entity || '']?.friendly_name}
                state={resolved[battery.soc_entity || '']?.state}
                unit={resolved[battery.soc_entity || '']?.unit}
                onChange={(v) => setBattery(prev => ({ ...prev, soc_entity: v || undefined }))}
                placeholder="sensor.battery_soc"
                helpText={SOLAR.batteryEntity}
              />
            ) : (
              <TopicField
                label="Battery SoC Topic"
                value={mqttBatteryTopic}
                onChange={setMqttBatteryTopic}
                placeholder="battery/soc_pct"
                helpText={SOLAR.batteryEntity}
              />
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Min SoC Reserve (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={battery.min_soc_reserve ?? 10}
                  onChange={(e) =>
                    setBattery(prev => ({ ...prev, min_soc_reserve: parseInt(e.target.value) || 10 }))
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Efficiency (0.5–1.0)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.5"
                  max="1.0"
                  value={battery.efficiency ?? 0.9}
                  onChange={(e) =>
                    setBattery(prev => ({ ...prev, efficiency: parseFloat(e.target.value) || 0.9 }))
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Voltage (V)
                </label>
                <input
                  type="number"
                  min="40"
                  max="60"
                  value={battery.voltage ?? 51.2}
                  onChange={(e) =>
                    setBattery(prev => ({ ...prev, voltage: parseFloat(e.target.value) || 51.2 }))
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Max Rate (kW)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="10"
                  value={battery.max_rate_kw ?? 3.0}
                  onChange={(e) =>
                    setBattery(prev => ({ ...prev, max_rate_kw: parseFloat(e.target.value) || 3.0 }))
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Grid — INSTRUCTION-394: own card, own enable state, saved independently
          of hasBattery. A meter-only or solar-no-battery install can wire the
          grid sensor without claiming a battery. */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] space-y-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hasGrid}
            onChange={(e) => setHasGrid(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          <span className="text-sm font-medium text-[var(--text)]">I have a grid import/export meter</span>
        </label>

        {hasGrid && (
          <div className="space-y-4 pl-4 border-l-2 border-[var(--border)]">
            {driver === 'ha' ? (
              <EntityField
                label="Grid Power Entity"
                value={grid.power_entity || ''}
                friendlyName={resolved[grid.power_entity || '']?.friendly_name}
                state={resolved[grid.power_entity || '']?.state}
                unit={resolved[grid.power_entity || '']?.unit}
                onChange={(v) => setGrid(prev => ({ ...prev, power_entity: v || undefined }))}
                placeholder="sensor.grid_power"
                helpText="kW, negative = export"
              />
            ) : (
              <TopicField
                label="Grid Power Topic"
                value={mqttGridTopic}
                onChange={setMqttGridTopic}
                placeholder="grid/import_w"
                helpText="kW, negative = export"
              />
            )}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Nominal Voltage (V)
                </label>
                <input
                  type="number"
                  min="220"
                  max="250"
                  value={grid.nominal_voltage ?? 230}
                  onChange={(e) =>
                    setGrid(prev => ({ ...prev, nominal_voltage: parseInt(e.target.value) || 230 }))
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Min Voltage (V)
                </label>
                <input
                  type="number"
                  min="190"
                  max="230"
                  value={grid.min_voltage ?? 207}
                  onChange={(e) =>
                    setGrid(prev => ({ ...prev, min_voltage: parseInt(e.target.value) || 207 }))
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text)] mb-1">
                  Max Voltage (V)
                </label>
                <input
                  type="number"
                  min="240"
                  max="260"
                  value={grid.max_voltage ?? 253}
                  onChange={(e) =>
                    setGrid(prev => ({ ...prev, max_voltage: parseInt(e.target.value) || 253 }))
                  }
                  className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text)]"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
