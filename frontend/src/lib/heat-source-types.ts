/**
 * Heat-pump-class source types. Both ASHP (`heat_pump`) and GSHP (`gshp`)
 * share UI treatment in the wizard and settings: COP terminology, no fuel
 * cost block, identical default range hints. Use this helper instead of
 * literal `=== 'heat_pump'` checks so adding further HP variants (e.g.
 * `water_source_heat_pump`) doesn't require sweep edits.
 */
export function isHeatPumpType(t: string | null | undefined): boolean {
  return t === 'heat_pump' || t === 'gshp'
}

/**
 * INSTRUCTION-646B — the off-power threshold of a heat source (kW): input
 * power below it reads as off. The band and the type values mirror the
 * backend (`qsh/pipeline/source_capabilities.py`: OFF_POWER_THRESHOLD_MIN_KW,
 * OFF_POWER_THRESHOLD_MAX_KW and the registry), which config load, the
 * Settings save and the wizard deploy enforce (INSTRUCTION-646A). The UI
 * flags a value outside the band before the save; the backend 422 is the
 * authority.
 */
export const OFF_POWER_THRESHOLD_MIN_KW = 0.05
export const OFF_POWER_THRESHOLD_MAX_KW = 1.0

/** The value a source reads with no setting: 0.1 kW heat pump, 0.5 kW boiler. */
export function defaultOffPowerThresholdKw(t: string | null | undefined): number {
  // The backend resolver gives 0.1 kW for any type that is not in its
  // registry, so only the three boiler types take 0.5 kW here.
  return t === 'gas_boiler' || t === 'oil_boiler' || t === 'lpg_boiler' ? 0.5 : 0.1
}

/**
 * The help text of the field, one text for Settings and the wizard. The
 * readback is one comparison per cycle, with no hysteresis, so the value
 * needs a margin above the standby draw.
 */
export function offPowerThresholdHelp(t: string | null | undefined): string {
  return (
    'Input power below this reads as off. Set it clearly above the power the ' +
    'unit takes while stopped (for example, a pump that runs on at 0.12 kW: ' +
    'set 0.2 kW), and below its input at start and at minimum modulation. ' +
    'For a heat pump, keep it at or below 0.2 kW. Blank uses ' +
    `${defaultOffPowerThresholdKw(t)} kW.`
  )
}

/** True when a set value is outside the band (NaN is outside). */
export function offPowerThresholdOutOfBand(v: number | undefined): boolean {
  return v !== undefined && !(v >= OFF_POWER_THRESHOLD_MIN_KW && v <= OFF_POWER_THRESHOLD_MAX_KW)
}
