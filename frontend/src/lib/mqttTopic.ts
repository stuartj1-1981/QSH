import type { MqttTopicInput } from '../types/config'

/** Extract topic string from either bare-string or MqttTopicInput value.
 *  Returns '' for null/undefined; returns '' for object inputs missing
 *  the `topic` field. */
export function extractTopic(v: string | MqttTopicInput | undefined | null): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  return v.topic ?? ''
}

/** Extract format from MqttTopicInput; undefined for strings/missing. */
export function extractFormat(
  v: string | MqttTopicInput | undefined | null,
): 'plain' | 'json' | undefined {
  if (!v || typeof v === 'string') return undefined
  return v.format
}

/** Extract json_path from MqttTopicInput; undefined for strings/missing. */
export function extractJsonPath(
  v: string | MqttTopicInput | undefined | null,
): string | undefined {
  if (!v || typeof v === 'string') return undefined
  return v.json_path
}

/** Narrow to MqttTopicInput, accepting bare-string legacy values.
 *  Mirrors StepSensors.asTopicInput. */
export function asTopicInput(
  v: string | MqttTopicInput | undefined | null,
): MqttTopicInput | undefined {
  if (!v) return undefined
  if (typeof v === 'string') return { topic: v, format: 'plain' }
  return v
}

/** INSTRUCTION-629D — the unit that an MQTT power topic declares. QSH reads
 *  a power topic in kW unless its entry declares 'W' (INSTRUCTION-629B). */
export type PowerUnit = 'W' | 'kW'

/** The `unit` that an entry holds: 'W', 'kW', '' when it holds none, or the
 *  text of a value that is not one of the two (a YAML written by hand). A
 *  `unit` key that holds the empty text is such a value, and it is given in
 *  quotation marks: QSH and the wizard's validation do not take it as a unit. */
export function storedPowerUnit(v: string | MqttTopicInput | undefined | null): string {
  if (!v || typeof v === 'string') return ''
  const unit: unknown = v.unit
  if (unit === undefined || unit === null) return ''
  if (typeof unit !== 'string') return JSON.stringify(unit)
  return unit.trim() === '' ? JSON.stringify(unit) : unit
}

/** The entry with `unit: 'W'`, or with no `unit` key for kW, the default. */
export function withPowerUnit(v: MqttTopicInput, unit: PowerUnit): MqttTopicInput {
  const next: MqttTopicInput = { ...v }
  if (unit === 'W') {
    next.unit = 'W'
  } else {
    delete next.unit
  }
  return next
}
