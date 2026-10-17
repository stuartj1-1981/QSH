/**
 * INSTRUCTION-581 — list-form helpers for the output topic fields
 * (`valve_setpoint`, `trv_setpoint`).
 *
 * The backend accepts a string or a list of strings for both fields
 * (INSTRUCTION-222B). A list means: publish the same value to every topic.
 *
 * Shape rules:
 *   - While the operator edits, a list stays a list. A blank entry stays in
 *     place (an open `+` slot). Nothing is spliced out by a keystroke.
 *   - At save, `dropEmptyTopics` removes blank entries and collapses the
 *     result: none -> undefined, one -> string, two or more -> list.
 */
export type TopicsValue = string | string[] | undefined

export const SETPOINT_TOPIC_KEYS = ['valve_setpoint', 'trv_setpoint'] as const
export type SetpointTopicKey = (typeof SETPOINT_TOPIC_KEYS)[number]

/** The topics as a new array. A string becomes a one-entry array. */
export function topicsOf(v: TopicsValue): string[] {
  if (v === undefined) return []
  return Array.isArray(v) ? [...v] : [v]
}

/** Collapse an array to the stored shape: none -> undefined, one -> string. */
export function shapeTopics(t: string[]): TopicsValue {
  if (t.length === 0) return undefined
  if (t.length === 1) return t[0] || undefined
  return t
}

/** Set the topic at `index`. Pads with blank entries if `index` is past the end. */
export function setTopicAt(v: TopicsValue, index: number, value: string): TopicsValue {
  const t = topicsOf(v)
  while (t.length < index) t.push('')
  t[index] = value
  return shapeTopics(t)
}

/** Add one blank slot. A string or empty value becomes a two-entry list. */
export function addTopicSlot(v: TopicsValue): string[] {
  const t = topicsOf(v)
  return t.length === 0 ? ['', ''] : [...t, '']
}

/** Remove the entry at `index`, then collapse. */
export function removeTopicAt(v: TopicsValue, index: number): TopicsValue {
  const t = topicsOf(v)
  t.splice(index, 1)
  return shapeTopics(t)
}

/** Save-time clean: drop blank entries, then collapse. An entry that is not a
 *  string (a hand-edited file) is dropped too, so that the form cannot throw. */
export function dropEmptyTopics(v: TopicsValue): TopicsValue {
  return shapeTopics(topicsOf(v).filter((x) => typeof x === 'string' && x.trim() !== ''))
}
