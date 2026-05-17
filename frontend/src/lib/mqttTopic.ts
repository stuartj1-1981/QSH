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
