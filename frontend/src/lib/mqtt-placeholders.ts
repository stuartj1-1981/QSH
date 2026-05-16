/**
 * Derive an MQTT topic placeholder for a sensor slot on a heat source card.
 *
 * Provenance: INSTRUCTION-241 V2 §D-5; INSTRUCTION-241B V3 Task 0 (M5
 * disposition — single source of truth across wizard + settings; ownership
 * moved from 241C V2 Task 1 to 241B V3 Task 0 to break the circular
 * Prerequisites dependency between 241B and 241C).
 *
 * Mode flag:
 *  - `singleSource: true` (wizard at 241B Task 3) — name-disambiguation
 *    suppressed. The wizard renders one source's pickers at a time via
 *    the tab strip; collision-detection across sources is not user-
 *    visible so the disambiguated slug form is surprising rather than
 *    helpful.
 *  - `singleSource: false` (settings at 241C Task 1, default) — name-
 *    disambiguation applied when types collide. Settings shows all source
 *    cards visible concurrently, so the helper is the user's main cue
 *    that two same-type sources need distinct topics.
 *
 * Rules (INSTRUCTION-241 V2 §D-5):
 *  - sources.length <= 1: legacy `heat_pump/<slot>` form retained for
 *    visual continuity with existing installs.
 *  - sources.length >= 2, unique types: `<type_stem>/<slot>`.
 *  - sources.length >= 2, type collision, singleSource:false: name-derived
 *    disambiguation slug prepended.
 *  - sources.length >= 2, type collision, singleSource:true: same as
 *    "unique types" — type-stem only.
 *
 * Backend subscribes to whatever the user actually enters; this helper
 * only shapes the placeholder hint. Duplicate-topic acceptance is
 * rejected at PATCH time by 241C Task 4's validator.
 */
export interface HeatSourceYaml {
  type?: string
  name?: string
  // (other fields irrelevant to placeholder derivation)
}

export interface PlaceholderMode {
  singleSource?: boolean
}

export function mqttSensorPlaceholder(
  sources: HeatSourceYaml[],
  index: number,
  slot: string,
  mode: PlaceholderMode = {},
): string {
  if (sources.length <= 1) return `heat_pump/${slot}`
  const current = sources[index] ?? {}
  const type = current.type ?? 'heat_pump'
  if (mode.singleSource) {
    return `${type}/${slot}`
  }
  const sameType = sources.filter((s) => (s.type ?? 'heat_pump') === type)
  if (sameType.length <= 1) {
    return `${type}/${slot}`
  }
  // Collision — prepend name slug.
  const nameSlug = (current.name ?? `source_${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
  const typeAbbrev = type === 'heat_pump' ? 'hp' : type.replace(/_boiler$/, '')
  return `${nameSlug}_${typeAbbrev}/${slot}`
}

export function mqttControlPlaceholder(
  sources: HeatSourceYaml[],
  index: number,
  slot: 'flow_temp/set' | 'mode/set',
  mode: PlaceholderMode = {},
): string {
  if (sources.length <= 1) return `heat_pump/${slot}`
  const stem = mqttSensorPlaceholder(sources, index, '', mode).replace(/\/$/, '')
  return `${stem}/${slot}`
}
