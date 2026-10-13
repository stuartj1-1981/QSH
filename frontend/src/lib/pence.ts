/**
 * INSTRUCTION-577F — the tariff rate inputs take pence per kWh, and the config
 * holds pounds per kWh. An input shows `penceFromPounds(rate)` and stores
 * `poundsFromPence(typed)`. A rate is kept to six decimal places of a pound
 * (four of a penny), so a typed value carries no float residue into qsh.yaml.
 */

/** The value in p/kWh that a rate input shows for a rate in £/kWh. */
export function penceFromPounds(pounds: number): number {
  return Number((pounds * 100).toFixed(4))
}

/** The rate in £/kWh that a value typed in p/kWh gives. */
export function poundsFromPence(pence: number): number {
  return Number((pence / 100).toFixed(6))
}

/** A rate above 0 and below this, in £/kWh, is shown with a hint under its
 *  input: below 1p/kWh it is most likely a rate in pounds typed into a pence
 *  input (owner ruling of 12 October 2026 on 577E OI-1). The hint does not
 *  stop the edit or the save. */
export const LOW_RATE_HINT_GBP_PER_KWH = 0.01

/** True when a stored rate is a finite number above 0 and below 1p/kWh. */
export function rateBelowOnePenny(rate: unknown): boolean {
  return (
    typeof rate === 'number' && Number.isFinite(rate) && rate > 0 && rate < LOW_RATE_HINT_GBP_PER_KWH
  )
}

/** The value of a rate input for a stored rate: the rate in p/kWh, or empty
 *  when the stored rate is not a finite number (a band list kept from the
 *  YAML can hold one), so the input never receives NaN. */
export function penceInputValue(rate: unknown): number | '' {
  return typeof rate === 'number' && Number.isFinite(rate) ? penceFromPounds(rate) : ''
}
