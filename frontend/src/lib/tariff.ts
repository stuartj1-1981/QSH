/**
 * Frontend default for energy.tariff_aggression_mode.
 *
 * SOURCE OF TRUTH — backend default lives at qsh/config.py:582
 * (energy.setdefault("tariff_aggression_mode", "optimise")). Same default is
 * consumed at qsh/pipeline/controllers/tariff_optimiser.py:66 and
 * qsh/validate_yaml.py:499. If the backend default ever changes, update this
 * constant AND those three backend sites in lockstep.
 *
 * Frontend-side, this constant is the ONLY default literal — both
 * TariffSettings (the Settings panel slider fallback at line ~386) and
 * StatusBanner (the home-page subtitle tariff segment) import from here. No
 * co-anchored frontend literals.
 */
import type { TariffAggressionMode } from '../types/config'

export const DEFAULT_TARIFF_AGGRESSION_MODE: TariffAggressionMode = 'optimise'

export const TARIFF_LABELS: Record<TariffAggressionMode, { short: string; tone: string }> = {
  comfort:    { short: 'Comfort',    tone: 'text-[var(--blue)]' },
  optimise:   { short: 'Optimise',   tone: 'text-[var(--green)]' },
  aggressive: { short: 'Aggressive', tone: 'text-[var(--amber)]' },
}
