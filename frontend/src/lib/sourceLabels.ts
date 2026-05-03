/**
 * INSTRUCTION-150E Tasks 5/6: Install-topology-aware source labels.
 *
 * Both helpers consume `activeSource` (the heat-source type currently
 * heating, e.g. 'heat_pump' / 'gas_boiler') and an install-topology hint.
 * Lives in a shared lib so React fast-refresh keeps the component files
 * pure-component-export.
 */

/**
 * Long-form cost-tile label.
 *
 * V2 E-H2: counts physical heat sources, NOT fuels in use. A
 * gas-boiler-with-electric-immersion install has heatSourceCount == 1
 * (just the boiler — immersion is backup, not a primary source) but
 * tariff_providers_status has 2 keys (electricity + gas). The latter
 * would mislabel as "Heating cost today" when the active source is
 * overwhelmingly the boiler.
 */
export function costLabelFor(
  activeSource: string | null | undefined,
  heatSourceCount: number,
): string {
  if (heatSourceCount > 1) return 'Heating cost today'
  if (activeSource === 'heat_pump') return 'HP cost today'
  if (activeSource === 'gas_boiler') return 'Gas cost today'
  if (activeSource === 'lpg_boiler') return 'LPG cost today'
  if (activeSource === 'oil_boiler') return 'Oil cost today'
  return 'Heating cost today'
}

/** Tight single-token form for in-line copy (alarm body, status pills,
 *  ARIA labels). Replaces hardcoded "HP" everywhere it appeared. */
export function sourceShortName(activeSource: string | null | undefined): string {
  if (activeSource === 'heat_pump') return 'HP'
  if (activeSource === 'gas_boiler') return 'Gas'
  if (activeSource === 'lpg_boiler') return 'LPG'
  if (activeSource === 'oil_boiler') return 'Oil'
  return 'Heat'
}
