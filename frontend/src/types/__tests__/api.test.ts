/**
 * INSTRUCTION-150E V2 E-H3 / V3 150E-V2-M3:
 *
 * Runtime parse tests for the Zod schemas. TypeScript types erase at
 * runtime; these tests assert that the schemas correctly accept conforming
 * payloads and reject malformed ones — the contract gate before useLive()
 * propagates a snapshot to component consumers.
 */
import { describe, it, expect } from 'vitest'
import {
  providerStatusSchema,
  testOctopusResponseSchema,
  testEdfRegionResponseSchema,
  cycleSnapshotSchema,
} from '../schemas'

describe('providerStatusSchema', () => {
  it('parses a representative Octopus electricity payload', () => {
    const payload = {
      fuel: 'electricity',
      provider_kind: 'octopus_electricity',
      last_refresh_at: 1745236800,
      stale: false,
      last_price: 0.245,
      source_url: 'https://api.octopus.energy/v1/...',
      last_error: null,
      tariff_label: 'Octopus Agile',
    }
    expect(() => providerStatusSchema.parse(payload)).not.toThrow()
  })

  it('parses an EDF FreePhase payload with non-null tariff_label', () => {
    const payload = {
      fuel: 'electricity',
      provider_kind: 'edf_freephase',
      last_refresh_at: 1745236800,
      stale: false,
      last_price: 0.18,
      source_url: 'https://www.edfenergy.com/...',
      last_error: null,
      tariff_label: 'EDF FreePhase Green Band',
    }
    expect(() => providerStatusSchema.parse(payload)).not.toThrow()
  })

  it('parses a fallback payload with null tariff_label', () => {
    const payload = {
      fuel: 'electricity',
      provider_kind: 'fallback',
      last_refresh_at: null,
      stale: true,
      last_price: 0.30,
      source_url: null,
      last_error: 'Provider not configured',
      tariff_label: null,
    }
    expect(() => providerStatusSchema.parse(payload)).not.toThrow()
  })

  it('rejects a payload missing tariff_label (regression catch for backend version drift)', () => {
    const payload = {
      fuel: 'electricity',
      provider_kind: 'octopus_electricity',
      last_refresh_at: 1745236800,
      stale: false,
      last_price: 0.245,
      source_url: null,
      last_error: null,
      // tariff_label intentionally absent
    }
    expect(() => providerStatusSchema.parse(payload)).toThrow()
  })

  it('rejects a payload with bogus provider_kind enum value', () => {
    const payload = {
      fuel: 'electricity',
      provider_kind: 'green_octopus_v9',
      last_refresh_at: 1745236800,
      stale: false,
      last_price: 0.245,
      source_url: null,
      last_error: null,
      tariff_label: null,
    }
    expect(() => providerStatusSchema.parse(payload)).toThrow()
  })
})

describe('testOctopusResponseSchema', () => {
  it('parses a response WITH gas_tariff_code', () => {
    const payload = {
      success: true,
      message: 'Connected',
      tariff_code: 'E-1R-AGILE-FLEX-22-11-25-A',
      additional_import_tariffs: [],
      export_tariff: null,
      gas_tariff_code: 'G-1R-TRACKER-22-11-25-A',
    }
    expect(() => testOctopusResponseSchema.parse(payload)).not.toThrow()
  })

  it('parses a response WITHOUT gas_tariff_code (no gas meter on account)', () => {
    const payload = {
      success: true,
      message: 'Connected',
      tariff_code: 'E-1R-AGILE-FLEX-22-11-25-A',
      additional_import_tariffs: [],
      export_tariff: null,
      gas_tariff_code: null,
    }
    expect(() => testOctopusResponseSchema.parse(payload)).not.toThrow()
  })
})

describe('testEdfRegionResponseSchema', () => {
  it('round-trips success', () => {
    const payload = { success: true, message: 'Region available' }
    expect(() => testEdfRegionResponseSchema.parse(payload)).not.toThrow()
  })

  it('round-trips failure', () => {
    const payload = { success: false, message: 'Region not supported' }
    expect(() => testEdfRegionResponseSchema.parse(payload)).not.toThrow()
  })
})

describe('cycleSnapshotSchema', () => {
  it('parses a minimal cycle message', () => {
    const payload = { type: 'cycle' }
    expect(() => cycleSnapshotSchema.parse(payload)).not.toThrow()
  })

  it('parses a cycle message with tariff_providers_status', () => {
    const payload = {
      type: 'cycle',
      tariff_providers_status: {
        electricity: {
          fuel: 'electricity',
          provider_kind: 'octopus_electricity',
          last_refresh_at: 1745236800,
          stale: false,
          last_price: 0.245,
          source_url: null,
          last_error: null,
          tariff_label: 'Octopus Agile',
        },
      },
      available_provider_kinds: ['octopus_electricity', 'edf_freephase', 'fixed', 'fallback'],
    }
    expect(() => cycleSnapshotSchema.parse(payload)).not.toThrow()
  })

  it('rejects a malformed payload (provider with bogus enum value)', () => {
    const payload = {
      type: 'cycle',
      tariff_providers_status: {
        electricity: {
          fuel: 'electricity',
          provider_kind: 'unknown_provider',
          last_refresh_at: 1745236800,
          stale: false,
          last_price: 0.245,
          source_url: null,
          last_error: null,
          tariff_label: null,
        },
      },
    }
    expect(() => cycleSnapshotSchema.parse(payload)).toThrow()
  })

  it('passes through unknown top-level fields (.passthrough())', () => {
    // The backend may add new fields in future releases; the schema must not
    // reject them. Required fields stay enforced.
    const payload = {
      type: 'cycle',
      future_field_added_in_152: { whatever: true },
    }
    expect(() => cycleSnapshotSchema.parse(payload)).not.toThrow()
  })
})
