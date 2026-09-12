// Driver-agnostic: this module exposes no HA entity IDs or MQTT topics.
/**
 * The historian rule, as pure functions (INSTRUCTION-524B T2).
 *
 * What the UI may safely write depends on the store record's persisted
 * migration state, on whether that state has been read yet, and on whether
 * the historian records — all reported by `GET /api/historian/setup`
 * (INSTRUCTION-524A T1). The panel and the wizard step both write through
 * these functions, so one rule serves both.
 *
 * No cell of the write table ever produces `backend: 'influxdb'`: the UI
 * offers the built-in store only (owner decision, 11 September 2026).
 */
import type { HistorianYaml } from '../types/config'
import type { HistorianSetupResponse } from '../types/api'

export type HistorianMode =
  | 'unknown'
  | 'unavailable'
  | 'unreadable'
  | 'migrating'
  | 'builtin'
  | 'legacy'
  | 'fresh'

export type HistorianAction =
  | 'enable'
  | 'disable'
  | 'use_builtin'
  | 'move_to_builtin'
  | 'resume'

type Section = HistorianYaml | null | undefined

/** `null` and `undefined` sections are `{}` everywhere in this module. */
function sec(section: Section): HistorianYaml {
  return section ?? {}
}

/**
 * Is the move of history to the built-in store paused by
 * `historian.store.shadow`?
 *
 * This mirrors the backend's `bool(store_cfg.get("shadow", default))`
 * (INSTRUCTION-524A T3) rather than testing `=== false`. A key present with
 * a non-boolean value — `shadow:` written with nothing after it reaches the
 * panel as `null` — resolves falsey in Python and must resolve parked here
 * too. Review finding R3, carried by DISPATCH-NOTE-524A-524B-2026-09-12.md;
 * the cleared text of INSTRUCTION-524B T2 used `=== false`, which disagrees
 * with the backend for exactly that class.
 */
export function isParked(section: Section): boolean {
  const s = sec(section).store?.shadow
  return s === undefined ? sec(section).backend === 'qsdb' : !s
}

/** The first mode whose condition holds (INSTRUCTION-524B T2). */
export function deriveHistorianMode(
  section: Section,
  setup: HistorianSetupResponse | null,
): HistorianMode {
  const s = sec(section)

  // 1. Nothing has read the record, so nothing may be written.
  //    The third limb cannot arise from INSTRUCTION-524A, which never
  //    reports `null` with a record; it is kept so that a backend that did
  //    would still write nothing.
  if (
    setup === null ||
    setup.record_state === 'unread' ||
    (setup.store_record && setup.record_state === null)
  ) {
    return 'unknown'
  }
  if (!setup.store_available) return 'unavailable'
  if (setup.record_state === 'unreadable') return 'unreadable'
  if (
    setup.record_state === 'shadow' ||
    setup.record_state === 'backfill' ||
    setup.record_state === 'reconciled'
  ) {
    return 'migrating'
  }
  if (
    setup.record_state === 'cutover' ||
    (setup.record_state === 'none' &&
      (s.backend === 'qsdb' ||
        (setup.store_open && setup.backend_effective === 'qsdb')))
  ) {
    return 'builtin'
  }
  if (setup.active && setup.backend_effective === 'influxdb') return 'legacy'
  return 'fresh'
}

/**
 * The section to send, or `null` for *no write*.
 *
 * Every non-null result spreads the loaded section first, so every key the
 * panel loaded survives the full-section PATCH.
 */
export function applyHistorianAction(
  section: Section,
  mode: HistorianMode,
  action: HistorianAction,
): HistorianYaml | null {
  const s = sec(section)

  const BUILTIN: HistorianYaml = {
    ...s,
    enabled: true,
    backend: 'qsdb',
    store: { ...s.store, shadow: false },
  }
  const RESUME: HistorianYaml = {
    ...s,
    enabled: true,
    store: { ...s.store, shadow: true },
  }
  const off: HistorianYaml = { ...s, enabled: false }

  switch (mode) {
    // An unread record may be mid-migration: write nothing at all.
    case 'unknown':
      return null

    case 'unavailable':
    case 'unreadable':
      return action === 'disable' ? off : null

    case 'migrating':
      // On a migrating record the only keys the panel writes are `enabled`
      // and `store.shadow: true` — never `backend` and never `shadow: false`,
      // either of which could meet `enter_shadow_if_migrating` wrongly.
      if (action === 'enable') {
        if (s.backend === 'qsdb' && s.store?.shadow !== true) {
          return { ...s, enabled: true, store: { ...s.store, shadow: true } }
        }
        return { ...s, enabled: true }
      }
      if (action === 'disable') return off
      // Offered on either backend (owner ruling on press point 1).
      if (action === 'resume') return isParked(s) ? RESUME : null
      return null

    case 'builtin':
    case 'fresh':
      if (action === 'enable' || action === 'use_builtin') return BUILTIN
      if (action === 'disable') return off
      return null

    case 'legacy':
      if (action === 'disable') return off
      if (action === 'move_to_builtin') {
        return s.store?.shadow === false
          ? { ...s, store: { ...s.store, shadow: true } }
          : null
      }
      return null
  }
}
