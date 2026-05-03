/**
 * INSTRUCTION-159A Task 2:
 *
 * Regression lock for the runtime Zod `providerKindSchema` parity. The 158-
 * series added `'ha_entity'` to `qsh/tariff/__init__.py SUPPORTED_PROVIDER_KINDS`
 * and to the TypeScript `ProviderKind` union in `api.ts`, but the runtime Zod
 * enum here was missed. Every WebSocket cycle payload then failed
 * `cycleSnapshotSchema.safeParse()` because the backend ships
 * `available_provider_kinds` containing `'ha_entity'`. `useLive()` kept the
 * data state at `null`, blanking Live View, Engineering, Settings → Tariff,
 * Settings → Seasonal Tuning, and the EDF FreePhase radio.
 *
 * V2 complete-fixture pattern: a single `validCycleFixture` mirrors the
 * actual `qsh/api/ws.py:113-186 _format_snapshot()` payload shape. Each test
 * spreads it and overrides ONLY the field-under-test, so a future schema
 * tightening that promotes a field to required surfaces here as a fixture-
 * update obligation rather than a silent test-skip.
 */
import { describe, it, expect } from 'vitest'
import {
  cycleSnapshotSchema,
  providerKindSchema,
} from '../schemas'

// Mirrors the WebSocket cycle payload from qsh/api/ws.py:113-186 _format_snapshot().
// Every field present even if currently optional in the schema, so that any future
// schema-tightening that promotes a field to required will surface here as a
// fixture-update obligation rather than a silent test-skip.
const validCycleFixture = {
  type: 'cycle' as const,
  timestamp: 1714665600,
  cycle_number: 12345,
  status: {
    operating_state: 'optimising',
    control_enabled: true,
    comfort_temp: 20.5,
    comfort_schedule_active: false,
    comfort_temp_active: 20.5,
    optimal_flow: 35.0,
    applied_flow: 35.0,
    optimal_mode: 'heat',
    applied_mode: 'heat',
    total_demand: 4.2,
    outdoor_temp: 7.5,
    heat_source: { primary: 'hp', shoulder_active: false },
    comfort_pct: 95,
    recovery_time_hours: null,
    capacity_pct: 60,
    hp_capacity_kw: 6.0,
    min_load_pct: 25,
  },
  hp: {},
  rooms: {},
  energy: {
    current_rate: 0.245,
    cost_today_pence: 152.3,
    cost_yesterday_pence: 187.0,
    energy_today_kwh: 12.4,
    predicted_saving: 0.0,
    predicted_energy_saving: 0.0,
    export_rate: null,
  },
  engineering: {
    det_flow: 35.0,
    rl_flow: 34.5,
    rl_blend: 0.5,
    rl_reward: 1.2,
    rl_loss: 0.05,
    shoulder_monitoring: false,
    summer_monitoring: false,
    cascade_active: false,
    frost_cap_active: false,
    antifrost_override_active: false,
    winter_equilibrium: false,
    antifrost_threshold: 7.0,
    signal_quality: 'good',
  },
  boost: { active: false, rooms: [] },
  away: { active: false, days: 0, recovery_active: false, zones_recovering: [] },
  source_selection: {},
  tariff_providers_status: {
    electricity: {
      fuel: 'electricity' as const,
      provider_kind: 'octopus_electricity' as const,
      last_refresh_at: 1714665000,
      stale: false,
      last_price: 0.27,
      source_url: 'https://api.octopus.energy/...',
      last_error: null,
      tariff_label: 'Octopus Agile',
    },
  },
  available_provider_kinds: [
    'octopus_electricity',
    'octopus_gas',
    'edf_freephase',
    'fixed',
    'fallback',
    'ha_entity',
  ] as const,
}

describe('cycleSnapshotSchema — provider_kind enum parity (159A)', () => {
  it('accepts the complete reference fixture as a baseline', () => {
    const result = cycleSnapshotSchema.safeParse(validCycleFixture)
    expect(result.success).toBe(true)
  })

  it('accepts ha_entity in available_provider_kinds (the 159A regression case)', () => {
    const payload = {
      ...validCycleFixture,
      available_provider_kinds: ['ha_entity'],
    }
    const result = cycleSnapshotSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('accepts every backend-supported provider_kind in the enum (parity with SUPPORTED_PROVIDER_KINDS)', () => {
    // Mirror of qsh/tariff/__init__.py SUPPORTED_PROVIDER_KINDS (158B).
    const allKinds = [
      'octopus_electricity',
      'octopus_gas',
      'edf_freephase',
      'fixed',
      'fallback',
      'ha_entity',
    ]
    const payload = { ...validCycleFixture, available_provider_kinds: allKinds }
    const result = cycleSnapshotSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('accepts ha_entity as a ProviderStatus.provider_kind value', () => {
    const payload = {
      ...validCycleFixture,
      tariff_providers_status: {
        electricity: {
          fuel: 'electricity',
          provider_kind: 'ha_entity',
          last_refresh_at: 1714665000,
          stale: false,
          last_price: 0.27,
          source_url: 'ha://event.octopus_energy_electricity_..._current_day_rates',
          last_error: null,
          tariff_label: 'HA Octopus integration',
        },
      },
    }
    const result = cycleSnapshotSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('rejects an unknown provider_kind (enum remains strict)', () => {
    const payload = {
      ...validCycleFixture,
      available_provider_kinds: ['fictitious_provider'],
    }
    const result = cycleSnapshotSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })
})

describe('providerKindSchema — direct enum coverage', () => {
  it('accepts every backend-supported member individually', () => {
    for (const k of [
      'octopus_electricity',
      'octopus_gas',
      'edf_freephase',
      'fixed',
      'fallback',
      'ha_entity',
    ]) {
      expect(providerKindSchema.safeParse(k).success).toBe(true)
    }
  })

  it('rejects an unknown member', () => {
    expect(providerKindSchema.safeParse('fictitious_provider').success).toBe(false)
  })
})
