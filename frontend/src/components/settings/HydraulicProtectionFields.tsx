import { cn } from '../../lib/utils'
import type { HeatSourceYaml, MqttTopicInput } from '../../types/config'

/**
 * INSTRUCTION-575H — hydraulic protection fields for the PRIMARY heat source
 * (heat_sources[0]); the config loader reads the three keys from it
 * (INSTRUCTION-575E). Shared by the wizard sensors step and Settings → Heat
 * Sources. The flags here are advice to the operator: this component blocks
 * no save and no wizard step.
 */
interface HydraulicProtectionFieldsProps {
  source: HeatSourceYaml
  /** Configured room keys (the YAML `rooms` mapping keys). */
  roomNames: string[]
  onChange: (changes: Partial<HeatSourceYaml>) => void
  /** Prefix for element ids — unique per mounted instance. */
  idPrefix: string
}

/** A flow-rate sensor is set: an HA entity id string or an MQTT topic object,
 *  blank values excluded. */
function flowRateSensorSet(value: string | MqttTopicInput | undefined): boolean {
  if (typeof value === 'string') return value.trim() !== ''
  return !!value && typeof value.topic === 'string' && value.topic.trim() !== ''
}

function parseNumber(raw: string): number | undefined {
  if (raw === '') return undefined
  const v = parseFloat(raw)
  return Number.isNaN(v) ? undefined : v
}

const inputClass =
  'w-full px-3 py-2 rounded-lg border bg-[var(--bg)] text-sm text-[var(--text)]'

export function HydraulicProtectionFields({
  source,
  roomNames,
  onChange,
  idPrefix,
}: HydraulicProtectionFieldsProps) {
  const minFlowRequired = flowRateSensorSet(source.sensors?.flow_rate)
  const minFlowMissing =
    minFlowRequired &&
    !(typeof source.min_flow_rate === 'number' && source.min_flow_rate > 0)
  const selected = source.bypass_rooms ?? []
  const staleRooms = selected.filter((r) => !roomNames.includes(r))
  const listedRooms = [...roomNames, ...staleRooms]

  const toggleRoom = (room: string, on: boolean) => {
    const next = on
      ? [...selected.filter((r) => r !== room), room]
      : selected.filter((r) => r !== room)
    onChange({ bypass_rooms: next.length > 0 ? next : undefined })
  }

  const minFlowId = `${idPrefix}-min-flow-rate`
  const setpointId = `${idPrefix}-bypass-setpoint`

  return (
    <div className="space-y-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <div>
        <h3 className="text-sm font-medium text-[var(--text)]">
          Hydraulic protection (primary heat source)
        </h3>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Protects the heat pump against low water flow. When flow drops too
          low, or the room valves are nearly closed, QSH forces the bypass
          rooms open.
        </p>
      </div>

      {minFlowRequired && (
        <div>
          <label
            htmlFor={minFlowId}
            className="block text-sm font-medium text-[var(--text)] mb-1"
          >
            Minimum flow rate (L/min)
            <span className="text-[var(--red)] ml-1">*</span>
          </label>
          <input
            id={minFlowId}
            type="number"
            min={0}
            step={0.1}
            required
            value={source.min_flow_rate ?? ''}
            aria-invalid={minFlowMissing}
            onChange={(e) => onChange({ min_flow_rate: parseNumber(e.target.value) })}
            className={cn(
              inputClass,
              minFlowMissing ? 'border-[var(--red)]' : 'border-[var(--border)]',
            )}
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            The heat pump&apos;s minimum flow rate, from its installation manual.
          </p>
          {minFlowMissing && (
            <p role="alert" className="text-xs text-[var(--red)] mt-1">
              Required when a flow-rate sensor is set. Enter a number above 0.
            </p>
          )}
        </div>
      )}

      <div>
        <label
          htmlFor={setpointId}
          className="block text-sm font-medium text-[var(--text)] mb-1"
        >
          Bypass room setpoint (°C)
        </label>
        <input
          id={setpointId}
          type="number"
          step={0.5}
          value={source.bypass_setpoint ?? ''}
          placeholder="25"
          onChange={(e) => onChange({ bypass_setpoint: parseNumber(e.target.value) })}
          className={cn(inputClass, 'border-[var(--border)]')}
        />
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Setpoint applied to a bypass room so its valve opens. Default 25 °C.
        </p>
      </div>

      <fieldset>
        <legend className="block text-sm font-medium text-[var(--text)] mb-1">
          Bypass rooms
        </legend>
        {listedRooms.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            No rooms are configured yet. Until you choose bypass rooms, QSH
            selects them automatically.
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {listedRooms.map((room) => {
              const stale = !roomNames.includes(room)
              return (
                <label
                  key={room}
                  className="flex items-center gap-2 text-sm text-[var(--text)]"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(room)}
                    onChange={(e) => toggleRoom(room, e.target.checked)}
                  />
                  {room}
                  {stale && (
                    <span className="text-xs text-[var(--red)]">
                      (not a configured room)
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        )}
        {selected.length === 0 && listedRooms.length > 0 && (
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Automatic selection: QSH picks up to two satisfied rooms.
          </p>
        )}
      </fieldset>
    </div>
  )
}
