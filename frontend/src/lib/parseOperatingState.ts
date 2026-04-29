import type { LiveViewState } from './liveViewTypes'

/**
 * Canonical strategy strings from ShadowController (shadow_controller.py).
 * _CYCLE_TYPE_MAP (line 34): "Defrost", "Oil Recovery", "Short Cycle Pause"
 * _hw_phase (line 41): "HW Pre-Charge", "HW Active", "HW Recovery"
 * Mode/strategy logic (lines 85–128): "Heating", "Equilibrium", "Monitoring"
 * Shadow mode (control_enabled=False): "Shadow (Strategy)" — composite
 *   form mirroring live mode. Legacy "Monitoring Only" still accepted.
 */

const STRATEGY_MAP: Record<
  string,
  {
    strategy: LiveViewState['strategy']
    hwState: LiveViewState['hwState']
    cyclePause: LiveViewState['cyclePause']
  }
> = {
  Heating: { strategy: 'heating', hwState: null, cyclePause: null },
  Equilibrium: { strategy: 'equilibrium', hwState: null, cyclePause: null },
  Monitoring: { strategy: 'monitoring', hwState: null, cyclePause: null },
  'HW Pre-Charge': { strategy: 'hw', hwState: 'pre_charge', cyclePause: null },
  'HW Active': { strategy: 'hw', hwState: 'hw_active', cyclePause: null },
  'HW Recovery': { strategy: 'hw', hwState: 'recovery', cyclePause: null },
  Defrost: { strategy: 'cycle_pause', hwState: null, cyclePause: 'defrost' },
  'Oil Recovery': {
    strategy: 'cycle_pause',
    hwState: null,
    cyclePause: 'oil_recovery',
  },
  'Short Cycle Pause': {
    strategy: 'cycle_pause',
    hwState: null,
    cyclePause: 'short_cycle',
  },
}

const MODE_MAP: Record<string, LiveViewState['season']> = {
  Winter: 'winter',
  Shoulder: 'shoulder',
  Summer: 'summer',
  Shadow: 'shadow',
}

export function parseOperatingState(
  raw: string | null | undefined,
): LiveViewState {
  const fallback: LiveViewState = {
    season: 'winter',
    strategy: 'heating',
    hwState: null,
    cyclePause: null,
    label: raw ?? 'Unknown',
  }

  if (!raw) return fallback

  // Special case: shadow mode (exact match)
  if (raw === 'Monitoring Only') {
    return {
      season: 'shadow',
      strategy: 'shadow',
      hwState: null,
      cyclePause: null,
      label: raw,
    }
  }

  // Parse "Mode (Strategy)" format — exactly one space before opening paren
  const match = raw.match(/^(\w+) \((.+)\)$/)
  if (!match) return { ...fallback, label: raw }

  const mode = match[1] // "Winter", "Shoulder", "Summer"
  const strategy = match[2] // "Heating", "HW Pre-Charge", etc.

  const season = MODE_MAP[mode]
  const strategyFields = STRATEGY_MAP[strategy]

  if (!season || !strategyFields) {
    // Unknown mode or strategy — ShadowController may have been updated
    // without a corresponding parser update. Log and return fallback.
    console.warn(`[LiveView] Unknown operating state: "${raw}"`)
    return { ...fallback, label: raw }
  }

  return { season, ...strategyFields, label: raw }
}
