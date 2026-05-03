/**
 * INSTRUCTION-150E Task 7a — useTariffStatus hook tests.
 *
 * Mocks useLive() and asserts that useTariffStatus correctly surfaces:
 *   - byFuel as a partial map (V2 E-H1)
 *   - edfFreephaseSupported reading available_provider_kinds (V5 E-M1)
 *   - providerKindFor() returning null for absent fuels
 *   - list sorted by fuel
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { CycleMessage, ProviderStatus } from '../../types/api'

const liveMock = vi.hoisted(() => ({ data: null as CycleMessage | null }))

vi.mock('../useLive', () => ({
  useLive: () => ({ data: liveMock.data, isConnected: true, lastUpdate: 0 }),
}))

import { useTariffStatus } from '../useTariffStatus'

const ELECTRICITY: ProviderStatus = {
  fuel: 'electricity',
  provider_kind: 'octopus_electricity',
  last_refresh_at: 1745236800,
  stale: false,
  last_price: 0.245,
  source_url: 'https://api.octopus.energy/...',
  last_error: null,
  tariff_label: 'Octopus Agile',
}

const GAS: ProviderStatus = {
  fuel: 'gas',
  provider_kind: 'octopus_gas',
  last_refresh_at: 1745236800,
  stale: false,
  last_price: 0.071,
  source_url: 'https://api.octopus.energy/...',
  last_error: null,
  tariff_label: 'Octopus Tracker (Gas)',
}

beforeEach(() => {
  liveMock.data = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useTariffStatus', () => {
  it('returns empty when snapshot null (cold start)', () => {
    liveMock.data = null
    const { result } = renderHook(() => useTariffStatus())
    expect(result.current.byFuel).toEqual({})
    expect(result.current.list).toEqual([])
    expect(result.current.edfFreephaseSupported).toBe(false)
    expect(result.current.providerKindFor('electricity')).toBeNull()
  })

  it('returns by-fuel when snapshot populated', () => {
    liveMock.data = {
      type: 'cycle',
      tariff_providers_status: { electricity: ELECTRICITY, gas: GAS },
      available_provider_kinds: ['octopus_electricity', 'octopus_gas', 'fixed', 'fallback'],
    }
    const { result } = renderHook(() => useTariffStatus())
    expect(result.current.byFuel.electricity?.tariff_label).toBe('Octopus Agile')
    expect(result.current.byFuel.gas?.tariff_label).toBe('Octopus Tracker (Gas)')
  })

  it('edfFreephaseSupported is false when capability absent', () => {
    liveMock.data = {
      type: 'cycle',
      tariff_providers_status: { electricity: ELECTRICITY },
      available_provider_kinds: ['octopus_electricity', 'fixed', 'fallback'],
    }
    const { result } = renderHook(() => useTariffStatus())
    expect(result.current.edfFreephaseSupported).toBe(false)
  })

  it('edfFreephaseSupported is true when capability present (V5 E-M1: backend supports the kind)', () => {
    liveMock.data = {
      type: 'cycle',
      tariff_providers_status: { electricity: ELECTRICITY },
      available_provider_kinds: ['octopus_electricity', 'edf_freephase', 'fixed', 'fallback'],
    }
    const { result } = renderHook(() => useTariffStatus())
    // V1 Catch-22 regression: the user is currently on Octopus, but EDF is in
    // available_provider_kinds. The radio MUST show, so the user can switch.
    expect(result.current.edfFreephaseSupported).toBe(true)
    expect(result.current.byFuel.electricity?.provider_kind).toBe('octopus_electricity')
  })

  it('edfFreephaseSupported is true when user already on EDF', () => {
    const edfStatus: ProviderStatus = {
      ...ELECTRICITY,
      provider_kind: 'edf_freephase',
      tariff_label: 'EDF FreePhase Green Band',
    }
    liveMock.data = {
      type: 'cycle',
      tariff_providers_status: { electricity: edfStatus },
      available_provider_kinds: ['octopus_electricity', 'edf_freephase', 'fixed', 'fallback'],
    }
    const { result } = renderHook(() => useTariffStatus())
    expect(result.current.edfFreephaseSupported).toBe(true)
    expect(result.current.providerKindFor('electricity')).toBe('edf_freephase')
  })

  it('providerKindFor returns null for absent fuel', () => {
    liveMock.data = {
      type: 'cycle',
      tariff_providers_status: { electricity: ELECTRICITY },
      available_provider_kinds: ['octopus_electricity'],
    }
    const { result } = renderHook(() => useTariffStatus())
    expect(result.current.providerKindFor('lpg')).toBeNull()
    expect(result.current.providerKindFor('gas')).toBeNull()
  })

  it('list is sorted by fuel for stable iteration', () => {
    // Insert in non-alphabetical order — output must be sorted.
    liveMock.data = {
      type: 'cycle',
      tariff_providers_status: { gas: GAS, electricity: ELECTRICITY },
      available_provider_kinds: ['octopus_electricity', 'octopus_gas'],
    }
    const { result } = renderHook(() => useTariffStatus())
    expect(result.current.list.map((s) => s.fuel)).toEqual(['electricity', 'gas'])
  })

  it('byFuel typed Partial — accessing absent fuel is undefined, not crash', () => {
    liveMock.data = {
      type: 'cycle',
      tariff_providers_status: { electricity: ELECTRICITY },
      available_provider_kinds: ['octopus_electricity'],
    }
    const { result } = renderHook(() => useTariffStatus())
    // V2 E-H1: lpg is absent from the install. The type system treats
    // result.byFuel.lpg as ProviderStatus | undefined; accessing .last_price
    // on it would be a compile error without ?. — runtime is undefined.
    expect(result.current.byFuel.lpg).toBeUndefined()
    expect(result.current.byFuel.electricity).toBeDefined()
  })
})
