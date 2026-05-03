/**
 * INSTRUCTION-150E Task 2:
 *
 * Hook surfacing per-fuel ProviderStatus from the latest cycle snapshot,
 * plus the backend's `available_provider_kinds` capability flag. Reuses
 * `useLive()` rather than fetching independently — both fields ride in
 * every WebSocket cycle push, no separate REST round-trip needed.
 *
 * V2 E-H1: `byFuel` is `Partial<Record<Fuel, ProviderStatus>>`, NOT a
 * total Record. Backend populates only fuels in the install (HP-only
 * install has just `electricity`).
 *
 * V5 E-M1: `edfFreephaseSupported` reads `available_provider_kinds` —
 * backend capability, NOT current configuration. Fixes the V1 Catch-22
 * where users couldn't switch to EDF because the radio hid until they'd
 * already selected it.
 */
import { useLive } from './useLive'
import type { Fuel, ProviderKind, ProviderStatus } from '../types/api'

export interface UseTariffStatusResult {
  /** Per-fuel provider status from the latest cycle snapshot.
   *  Partial map — fuels not in the install are absent (NOT undefined entries
   *  in a total Record). */
  byFuel: Partial<Record<Fuel, ProviderStatus>>
  /** Convenience: provider statuses sorted by fuel for stable iteration. */
  list: ProviderStatus[]
  /** True if the backend supports the EDF FreePhase provider kind (post-150D
   *  builds). Gates the EDF radio in TariffSettings / StepTariff. NOT "EDF
   *  is currently configured" — that would Catch-22 the user, who needs to
   *  see the radio in order to select EDF in the first place. */
  edfFreephaseSupported: boolean
  /** Convenience: provider_kind for a given fuel, or null if absent from
   *  the install. */
  providerKindFor: (fuel: Fuel) => ProviderKind | null
}

export function useTariffStatus(): UseTariffStatusResult {
  const { data } = useLive()
  const byFuel: Partial<Record<Fuel, ProviderStatus>> =
    data?.tariff_providers_status ?? {}
  const list = Object.values(byFuel)
    .filter((s): s is ProviderStatus => s != null)
    .sort((a, b) => a.fuel.localeCompare(b.fuel))
  const supportedKinds = data?.available_provider_kinds ?? []
  const edfFreephaseSupported = supportedKinds.includes('edf_freephase')
  return {
    byFuel,
    list,
    edfFreephaseSupported,
    providerKindFor: (fuel) => byFuel[fuel]?.provider_kind ?? null,
  }
}
