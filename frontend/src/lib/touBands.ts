/**
 * INSTRUCTION-577C — the arithmetic of a manual time-of-use day.
 *
 * A day is a list of bands, each a start "HH:MM" on the half-hour and a rate
 * in £/kWh. A band ends where the next band starts, and the band with the
 * latest start runs through midnight to the earliest start. Given a list sorted
 * by start, with every start "HH:MM" on the half-hour and no start twice (as
 * hydrateBands returns it), each function that returns a list returns such a
 * list, so the band lengths always add up to 24 h (MINUTES_PER_DAY). The
 * backend refuses a list of any other form (qsh/tariff/time_of_use.py::
 * band_errors); hydrateBands sorts a list read from the config, and turns a
 * list that does not have the form of bandFormAdmitted into one band.
 */
import type { TouBand } from '../types/config'

export const MINUTES_PER_DAY = 24 * 60
export const GRID_MINUTES = 30

export function toMinutes(start: string): number {
  const [hours, minutes] = start.split(':')
  return Number(hours) * 60 + Number(minutes)
}

export function toStart(minutes: number): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Every start on the half-hour grid, "00:00" to "23:30". */
export const ALL_STARTS: readonly string[] = Array.from(
  { length: MINUTES_PER_DAY / GRID_MINUTES },
  (_, i) => toStart(i * GRID_MINUTES),
)

/** A rate the backend admits: a finite number above 0. */
export function rateAdmitted(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
}

/** True when every band has a rate the backend admits. */
export function allRatesAdmitted(bands: TouBand[]): boolean {
  return bands.every((band) => rateAdmitted(band.rate))
}

export function sortBands(bands: TouBand[]): TouBand[] {
  return [...bands].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
}

/** The length of each band in minutes, for a sorted list. One band is the whole day. */
export function bandLengths(bands: TouBand[]): number[] {
  return bands.map((band, i) => {
    const next = bands[(i + 1) % bands.length]
    const gap = (toMinutes(next.start) - toMinutes(band.start) + MINUTES_PER_DAY) % MINUTES_PER_DAY
    return gap === 0 ? MINUTES_PER_DAY : gap
  })
}

export function totalMinutes(bands: TouBand[]): number {
  return bandLengths(bands).reduce((sum, length) => sum + length, 0)
}

/** The end of a band: the start of the next band. */
export function bandEnd(bands: TouBand[], index: number): string {
  return bands[(index + 1) % bands.length].start
}

/** One band over the whole day, at the given rate. */
export function defaultBands(rate: number): TouBand[] {
  return [{ start: '00:00', rate }]
}

/** True when a list read from the config has the form that the backend admits
 *  for a band list, rates aside: a non-empty array of objects that hold only
 *  `start` and `rate`, each start "HH:MM" on the half-hour, no start twice.
 *  The editor flags a rate that the backend refuses. */
export function bandFormAdmitted(bands: unknown): bands is TouBand[] {
  if (!Array.isArray(bands) || bands.length === 0) return false
  const starts: unknown[] = []
  for (const band of bands) {
    if (typeof band !== 'object' || band === null) return false
    if (Object.keys(band).some((key) => key !== 'start' && key !== 'rate')) return false
    starts.push((band as { start?: unknown }).start)
  }
  const onGrid = starts.every((start) => typeof start === 'string' && ALL_STARTS.includes(start))
  return onGrid && new Set(starts).size === starts.length
}

/** A band list read from the config, sorted; a list that does not have the form
 *  of bandFormAdmitted (missing, empty, or one that the backend refuses for its
 *  form) becomes one band at the given rate. */
export function hydrateBands(bands: unknown, rate: number): TouBand[] {
  return bandFormAdmitted(bands) ? sortBands(bands) : defaultBands(rate)
}

/** Split a band at its middle, or at the half-hour below its middle when the
 *  middle is off the grid; the new band takes its rate. A band of 30 minutes
 *  cannot be split, and the list comes back unchanged. */
export function splitBand(bands: TouBand[], index: number): TouBand[] {
  const length = bandLengths(bands)[index]
  if (length < 2 * GRID_MINUTES) return bands
  const offset = Math.floor(length / 2 / GRID_MINUTES) * GRID_MINUTES
  const start = toStart(toMinutes(bands[index].start) + offset)
  return sortBands([...bands, { start, rate: bands[index].rate }])
}

/** Remove a band; the band before it then runs to the next start.
 *  The last band cannot be removed, and the list comes back unchanged. */
export function removeBand(bands: TouBand[], index: number): TouBand[] {
  if (bands.length <= 1) return bands
  return bands.filter((_, i) => i !== index)
}

/** The starts a band may move to: the half-hours strictly between the starts of
 *  the bands on each side, so that no band becomes empty and the order holds.
 *  One band may start at any half-hour. */
export function startOptions(bands: TouBand[], index: number): string[] {
  if (bands.length === 1) return [...ALL_STARTS]
  const previous = toMinutes(bands[(index - 1 + bands.length) % bands.length].start)
  const next = toMinutes(bands[(index + 1) % bands.length].start)
  const span = (next - previous + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY
  const options: string[] = []
  for (let offset = GRID_MINUTES; offset < span; offset += GRID_MINUTES) {
    options.push(toStart(previous + offset))
  }
  return options
}

/** Move the start of a band. A start outside startOptions leaves the list unchanged. */
export function moveStart(bands: TouBand[], index: number, start: string): TouBand[] {
  if (!startOptions(bands, index).includes(start)) return bands
  return sortBands(bands.map((band, i) => (i === index ? { ...band, start } : band)))
}

export function setRate(bands: TouBand[], index: number, rate: number): TouBand[] {
  return bands.map((band, i) => (i === index ? { ...band, rate } : band))
}

export function formatLength(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}
