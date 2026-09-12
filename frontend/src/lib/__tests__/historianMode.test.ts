/**
 * INSTRUCTION-524B T6(a) — the mode table, the write table, preservation and
 * the invariants that hold across the whole table.
 */
import { describe, it, expect } from 'vitest'
import {
  applyHistorianAction,
  deriveHistorianMode,
  isParked,
  type HistorianAction,
  type HistorianMode,
} from '../historianMode'
import type { HistorianYaml } from '../../types/config'
import type { HistorianSetupResponse } from '../../types/api'

function setup(over: Partial<HistorianSetupResponse> = {}): HistorianSetupResponse {
  return {
    store_available: true,
    store_record: false,
    record_state: null,
    historian: true,
    store_open: false,
    active: false,
    backend_config: 'influxdb',
    backend_effective: null,
    enabled: false,
    ...over,
  }
}

/* ── the mode table ────────────────────────────────────────────────── */

describe('deriveHistorianMode — each row by the smallest input that reaches it', () => {
  it('row 1a — setup is null', () => {
    expect(deriveHistorianMode({}, null)).toBe('unknown')
  })

  it('row 1b — the record is unread', () => {
    expect(deriveHistorianMode({}, setup({ record_state: 'unread' }))).toBe('unknown')
  })

  it('row 1c — a record with no state', () => {
    // Cannot arise from INSTRUCTION-524A; kept so a backend that did report
    // it would still write nothing.
    expect(
      deriveHistorianMode({}, setup({ store_record: true, record_state: null })),
    ).toBe('unknown')
  })

  it('row 1 beats row 2 — unread on an unavailable store is still unknown', () => {
    expect(
      deriveHistorianMode({}, setup({ store_available: false, record_state: 'unread' })),
    ).toBe('unknown')
  })

  it('row 2 — the store cannot run', () => {
    expect(deriveHistorianMode({}, setup({ store_available: false }))).toBe('unavailable')
  })

  it('row 3 — the record cannot be read', () => {
    expect(deriveHistorianMode({}, setup({ record_state: 'unreadable' }))).toBe('unreadable')
  })

  it.each(['shadow', 'backfill', 'reconciled'] as const)('row 4 — %s', (state) => {
    expect(deriveHistorianMode({}, setup({ record_state: state }))).toBe('migrating')
  })

  it('row 5a — a cutover record', () => {
    expect(deriveHistorianMode({}, setup({ record_state: 'cutover' }))).toBe('builtin')
  })

  it('row 5b — a none record on a qsdb section', () => {
    expect(
      deriveHistorianMode({ backend: 'qsdb' }, setup({ record_state: 'none' })),
    ).toBe('builtin')
  })

  it('row 5c — a none record with the store open and effective', () => {
    expect(
      deriveHistorianMode(
        {},
        setup({ record_state: 'none', store_open: true, backend_effective: 'qsdb' }),
      ),
    ).toBe('builtin')
  })

  it('row 6 — InfluxDB answered and no migrating record', () => {
    expect(
      deriveHistorianMode({}, setup({ active: true, backend_effective: 'influxdb' })),
    ).toBe('legacy')
  })

  it('row 7 — everything else', () => {
    expect(deriveHistorianMode({}, setup())).toBe('fresh')
  })

  it('a none record alone is not builtin — it falls through to fresh', () => {
    expect(deriveHistorianMode({}, setup({ record_state: 'none' }))).toBe('fresh')
  })
})

describe('deriveHistorianMode — null and undefined sections behave as {}', () => {
  const cases: Array<[HistorianMode, HistorianSetupResponse | null]> = [
    ['unknown', null],
    ['unavailable', setup({ store_available: false })],
    ['unreadable', setup({ record_state: 'unreadable' })],
    ['migrating', setup({ record_state: 'shadow' })],
    ['builtin', setup({ record_state: 'cutover' })],
    ['legacy', setup({ active: true, backend_effective: 'influxdb' })],
    ['fresh', setup()],
  ]

  it.each(cases)('%s', (mode, s) => {
    expect(deriveHistorianMode(null, s)).toBe(mode)
    expect(deriveHistorianMode(undefined, s)).toBe(mode)
  })
})

/* ── isParked ──────────────────────────────────────────────────────── */

describe('isParked — mirrors the backend bool(), not === false', () => {
  it('explicit false is parked', () => {
    expect(isParked({ store: { shadow: false } })).toBe(true)
  })

  it('qsdb with no key is parked — 524A T3 flipped that default', () => {
    expect(isParked({ backend: 'qsdb' })).toBe(true)
  })

  it('qsdb with an explicit true is not parked', () => {
    expect(isParked({ backend: 'qsdb', store: { shadow: true } })).toBe(false)
  })

  it('influxdb with no key is not parked', () => {
    expect(isParked({ backend: 'influxdb' })).toBe(false)
    expect(isParked({})).toBe(false)
  })

  it('present but null is parked on either backend (review finding R3)', () => {
    // `shadow:` written with nothing after it reaches the panel as null.
    // Python resolves bool(None) false, so the move is parked; the cleared
    // `=== false` test called it not parked on an influxdb section.
    const asNull = { store: { shadow: null } } as unknown as HistorianYaml
    expect(isParked(asNull)).toBe(true)
    expect(isParked({ ...asNull, backend: 'influxdb' } as HistorianYaml)).toBe(true)
  })

  it('null and undefined sections are not parked', () => {
    expect(isParked(null)).toBe(false)
    expect(isParked(undefined)).toBe(false)
  })
})

/* ── the write table, cell by cell ─────────────────────────────────── */

const ACTIONS: HistorianAction[] = [
  'enable',
  'disable',
  'use_builtin',
  'move_to_builtin',
  'resume',
]

describe('applyHistorianAction — every cell', () => {
  it('unknown writes nothing, whatever the action', () => {
    for (const a of ACTIONS) {
      expect(applyHistorianAction({ enabled: true }, 'unknown', a)).toBeNull()
    }
  })

  it.each(['unavailable', 'unreadable'] as const)('%s: only disable writes', (mode) => {
    for (const a of ACTIONS) {
      const out = applyHistorianAction({ enabled: true }, mode, a)
      if (a === 'disable') expect(out).toEqual({ enabled: false })
      else expect(out).toBeNull()
    }
  })

  describe('migrating', () => {
    it('enable on a non-qsdb section writes enabled only', () => {
      expect(applyHistorianAction({ enabled: false }, 'migrating', 'enable')).toEqual({
        enabled: true,
      })
    })

    it('enable on a parked qsdb section also un-parks it', () => {
      expect(
        applyHistorianAction({ enabled: false, backend: 'qsdb' }, 'migrating', 'enable'),
      ).toEqual({ enabled: true, backend: 'qsdb', store: { shadow: true } })
    })

    it('enable on a qsdb section already shadowing writes enabled only', () => {
      expect(
        applyHistorianAction(
          { enabled: false, backend: 'qsdb', store: { shadow: true } },
          'migrating',
          'enable',
        ),
      ).toEqual({ enabled: true, backend: 'qsdb', store: { shadow: true } })
    })

    it('disable writes enabled false', () => {
      expect(applyHistorianAction({ enabled: true }, 'migrating', 'disable')).toEqual({
        enabled: false,
      })
    })

    it('resume writes RESUME when parked, on either backend', () => {
      expect(
        applyHistorianAction({ enabled: true, store: { shadow: false } }, 'migrating', 'resume'),
      ).toEqual({ enabled: true, store: { shadow: true } })
      expect(
        applyHistorianAction({ enabled: true, backend: 'qsdb' }, 'migrating', 'resume'),
      ).toEqual({ enabled: true, backend: 'qsdb', store: { shadow: true } })
    })

    it('resume writes nothing when not parked', () => {
      expect(
        applyHistorianAction({ enabled: true, store: { shadow: true } }, 'migrating', 'resume'),
      ).toBeNull()
    })

    it('use_builtin and move_to_builtin write nothing', () => {
      expect(applyHistorianAction({}, 'migrating', 'use_builtin')).toBeNull()
      expect(applyHistorianAction({}, 'migrating', 'move_to_builtin')).toBeNull()
    })
  })

  describe.each(['builtin', 'fresh'] as const)('%s', (mode) => {
    it('enable and use_builtin both write BUILTIN', () => {
      const expected = { enabled: true, backend: 'qsdb', store: { shadow: false } }
      expect(applyHistorianAction({ enabled: false }, mode, 'enable')).toEqual(expected)
      expect(applyHistorianAction({ enabled: false }, mode, 'use_builtin')).toEqual(expected)
    })

    it('disable writes enabled false', () => {
      expect(applyHistorianAction({ enabled: true }, mode, 'disable')).toEqual({
        enabled: false,
      })
    })

    it('move_to_builtin and resume write nothing', () => {
      expect(applyHistorianAction({}, mode, 'move_to_builtin')).toBeNull()
      expect(applyHistorianAction({}, mode, 'resume')).toBeNull()
    })
  })

  describe('legacy', () => {
    it('move_to_builtin un-parks a parked section', () => {
      expect(
        applyHistorianAction({ enabled: true, store: { shadow: false } }, 'legacy', 'move_to_builtin'),
      ).toEqual({ enabled: true, store: { shadow: true } })
    })

    it('move_to_builtin writes nothing when the key is not false', () => {
      expect(applyHistorianAction({ enabled: true }, 'legacy', 'move_to_builtin')).toBeNull()
    })

    it('disable writes enabled false; enable, use_builtin and resume write nothing', () => {
      expect(applyHistorianAction({ enabled: true }, 'legacy', 'disable')).toEqual({
        enabled: false,
      })
      expect(applyHistorianAction({ enabled: true }, 'legacy', 'enable')).toBeNull()
      expect(applyHistorianAction({ enabled: true }, 'legacy', 'use_builtin')).toBeNull()
      expect(applyHistorianAction({ enabled: true }, 'legacy', 'resume')).toBeNull()
    })
  })
})

/* ── preservation and invariants, over the whole table ─────────────── */

const MODES: HistorianMode[] = [
  'unknown',
  'unavailable',
  'unreadable',
  'migrating',
  'builtin',
  'legacy',
  'fresh',
]

/** A section carrying every key class the panel can load. */
function loaded(over: Partial<HistorianYaml> = {}): HistorianYaml {
  return {
    enabled: true,
    host: 'a0d7b954-influxdb',
    port: 8086,
    password: '***REDACTED***',
    mirror: { influxdb: { enabled: true } },
    ...over,
    store: { retention_days: 30, cutover: 'manual', ...over.store },
  }
}

describe('preservation — every loaded key survives every non-null write', () => {
  it.each(MODES)('%s', (mode) => {
    for (const action of ACTIONS) {
      for (const extra of [{}, { backend: 'qsdb' as const }, { store: { shadow: false } }]) {
        const section = loaded(extra)
        const out = applyHistorianAction(section, mode, action)
        if (out === null) continue
        expect(out.host).toBe(section.host)
        expect(out.port).toBe(section.port)
        expect(out.password).toBe(section.password)
        expect(out.mirror).toEqual(section.mirror)
        expect(out.store?.retention_days).toBe(30)
        expect(out.store?.cutover).toBe('manual')
      }
    }
  })
})

describe('invariants over the whole table', () => {
  it('no write is ever produced in unknown', () => {
    for (const action of ACTIONS) {
      expect(applyHistorianAction(loaded(), 'unknown', action)).toBeNull()
    }
  })

  it('backend influxdb is never introduced', () => {
    for (const mode of MODES) {
      for (const action of ACTIONS) {
        const out = applyHistorianAction(loaded(), mode, action)
        if (out === null) continue
        expect(out.backend).not.toBe('influxdb')
      }
    }
    // …and it survives when the loaded section already had it.
    const out = applyHistorianAction(loaded({ backend: 'influxdb' }), 'migrating', 'enable')
    expect(out?.backend).toBe('influxdb')
  })

  it('a migrating record never receives backend qsdb or shadow false', () => {
    for (const action of ACTIONS) {
      for (const extra of [{}, { backend: 'qsdb' as const }, { store: { shadow: false } }]) {
        const section = loaded(extra)
        const out = applyHistorianAction(section, 'migrating', action)
        if (out === null) continue
        if (section.backend !== 'qsdb') expect(out.backend).toBeUndefined()
        // A loaded `false` survives — that is preservation. What must never
        // happen is a cell *setting* it on a migrating record.
        if (section.store?.shadow !== false) expect(out.store?.shadow).not.toBe(false)
      }
    }
  })

  it('migrating + enable on a qsdb section always leaves shadow true', () => {
    for (const shadow of [undefined, false, true]) {
      const section: HistorianYaml = {
        enabled: false,
        backend: 'qsdb',
        ...(shadow === undefined ? {} : { store: { shadow } }),
      }
      const out = applyHistorianAction(section, 'migrating', 'enable')
      expect(out?.store?.shadow).toBe(true)
    }
  })
})
