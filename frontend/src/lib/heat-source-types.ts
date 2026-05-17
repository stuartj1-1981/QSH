import type { HeatSourceYaml } from '../types/config'

/**
 * Heat-pump-class source types. Both ASHP (`heat_pump`) and GSHP (`gshp`)
 * share UI treatment in the wizard and settings: COP terminology, no fuel
 * cost block, identical default range hints. Use this helper instead of
 * literal `=== 'heat_pump'` checks so adding further HP variants (e.g.
 * `water_source_heat_pump`) doesn't require sweep edits.
 */
export function isHeatPumpType(t: HeatSourceYaml['type'] | undefined): boolean {
  return t === 'heat_pump' || t === 'gshp'
}
