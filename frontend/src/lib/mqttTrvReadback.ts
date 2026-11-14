import type { MqttTopicInput, RoomMqttTopicValue, RoomMqttTrvReadbackValue } from '../types/config'

/** INSTRUCTION-627B — read and write rooms.<room>.mqtt_topics.trv_setpoint_readback.
 *  The value is a topic, a mapping, or a list of these (one for each TRV of
 *  the room). The forms edit one topic; a list of two or more is shown and
 *  not changed. */

function entryTopic(entry: RoomMqttTopicValue | undefined): string {
  if (!entry) return ''
  return (typeof entry === 'string' ? entry : entry.topic ?? '').trim()
}

function firstEntry(v: RoomMqttTrvReadbackValue | undefined): RoomMqttTopicValue | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** Every topic of the value that is not blank, in order. */
export function readbackTopics(v: RoomMqttTrvReadbackValue | undefined): string[] {
  const entries = Array.isArray(v) ? v : v ? [v] : []
  return entries.map(entryTopic).filter((topic) => topic !== '')
}

export function readbackTopic(v: RoomMqttTrvReadbackValue | undefined): string {
  return entryTopic(firstEntry(v))
}

export function readbackJsonPath(v: RoomMqttTrvReadbackValue | undefined): string {
  const first = firstEntry(v)
  if (!first || typeof first === 'string') return ''
  return first.format === 'json' ? first.json_path ?? '' : ''
}

/** The new value. A blank topic clears the key. With no JSON key and no
 *  other key, the value is the topic string; else a mapping that keeps the
 *  other keys of the earlier mapping (category, availability, last_seen). */
export function writeReadback(
  prev: RoomMqttTrvReadbackValue | undefined,
  next: { topic: string; jsonPath: string },
): RoomMqttTopicValue | undefined {
  const topic = next.topic.trim()
  if (!topic) return undefined
  const jsonPath = next.jsonPath.trim()
  const first = firstEntry(prev)
  const base: Record<string, unknown> = first && typeof first === 'object' ? { ...first } : {}
  delete base.topic
  delete base.format
  delete base.json_path
  if (!jsonPath && Object.keys(base).length === 0) return topic
  return {
    ...(base as Partial<MqttTopicInput>),
    topic,
    ...(jsonPath ? { format: 'json' as const, json_path: jsonPath } : {}),
  }
}
