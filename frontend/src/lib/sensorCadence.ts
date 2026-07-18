// INSTRUCTION-420 — sensor-cadence class → display label + per-room copy.
// Match on the API value ("ok" / "coarse" / "blocked" / "insufficient"),
// never the display text. The copy renders the measured quantities (D3/QG5)
// and names the fix mechanism; the 415 rejection ledger (Engineering row
// expansion) is the drill-down. Shared by the Engineering Sensor column and
// the wizard review advisory (advisory only — never blocks anything).

import type { SensorCadence } from '../types/api'

export const EMPTY_CADENCE: SensorCadence = {
  class: 'insufficient',
  median_step_c: null,
  median_interval_s: null,
  admissible_fraction: null,
  event_count: 0,
  window_span_s: null,
}

export function cadenceLabel(cls: string): string {
  switch (cls) {
    case 'ok':
      return 'OK'
    case 'coarse':
      return 'Coarse'
    case 'blocked':
      return 'Blocked'
    default:
      return 'Measuring'
  }
}

export function cadenceEventsPerDay(c: SensorCadence): string | null {
  if (c.window_span_s && c.window_span_s > 0 && c.event_count > 1) {
    return ((c.event_count - 1) / (c.window_span_s / 86400)).toFixed(1)
  }
  return null
}

export function cadenceCopy(c: SensorCadence): string {
  const eventsPerDay = cadenceEventsPerDay(c)
  switch (c.class) {
    case 'blocked':
      return 'This sensor cannot feed room learning at current settings: no observed update step fits the estimator’s admission gate. Check the device’s reporting deadband, minimum-report-interval, or device class. Expand the row for the U observation ledger (the rejection counts).'
    case 'coarse':
      return `Learns at reduced rate — a share of updates arrive too coarse to use (${
        c.admissible_fraction != null ? Math.round(c.admissible_fraction * 100) : '—'
      }% admissible, median step ${
        c.median_step_c != null ? c.median_step_c.toFixed(2) : '—'
      } °C${eventsPerDay ? `, ${eventsPerDay} updates/day` : ''}).`
    case 'ok':
      return `Sensor reporting is compatible with room learning${
        eventsPerDay ? ` (${eventsPerDay} updates/day)` : ''
      }.`
    default:
      return 'Measuring — too few sensor updates observed yet to classify. Check the Engineering page after the first night.'
  }
}
