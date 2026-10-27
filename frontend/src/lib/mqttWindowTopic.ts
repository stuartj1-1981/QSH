import type { MqttTopicInput, RoomMqttWindowTopicValue } from '../types/config'

/** INSTRUCTION-604B — read and write rooms.<room>.mqtt_topics.window_sensor. */
export function windowTopic(v: RoomMqttWindowTopicValue | undefined): string {
  if (!v) return ''
  return typeof v === 'string' ? v : v.topic ?? ''
}

export function windowJsonPath(v: RoomMqttWindowTopicValue | undefined): string {
  if (!v || typeof v === 'string') return ''
  return v.format === 'json' ? v.json_path ?? '' : ''
}

export function windowInvert(v: RoomMqttWindowTopicValue | undefined): boolean {
  return !!v && typeof v !== 'string' && v.invert === true
}

/** The new value. A blank topic clears the key. With no JSON key, no invert
 *  and no other key, the value is the topic string; else a mapping that keeps
 *  the other keys of the earlier mapping (availability, last_seen). */
export function writeWindowTopic(
  prev: RoomMqttWindowTopicValue | undefined,
  next: { topic: string; jsonPath: string; invert: boolean },
): RoomMqttWindowTopicValue | undefined {
  const topic = next.topic.trim()
  if (!topic) return undefined
  const jsonPath = next.jsonPath.trim()
  const base: Record<string, unknown> = prev && typeof prev === 'object' ? { ...prev } : {}
  delete base.topic
  delete base.format
  delete base.json_path
  delete base.invert
  if (!jsonPath && !next.invert && Object.keys(base).length === 0) return topic
  return {
    ...(base as Partial<MqttTopicInput>),
    topic,
    ...(jsonPath ? { format: 'json' as const, json_path: jsonPath } : {}),
    ...(next.invert ? { invert: true } : {}),
  }
}
