import { z } from 'zod'

// Runtime schemas for the 8 interfaces from 208B. Critical literals
// enforced: AlarmEventSchema.severity = z.literal('notification') (per
// design §6.3 + 201C V3 contract); FeatureFlagsResponseSchema's
// deferred_enforcement_note is required (per 208A V2 HIGH-2).

export const ForecastStateSnapshotSchema = z.object({
  oat_rise_next_6h_c: z.number().nullable(),
  solar_kwh_12h: z.number().nullable(),
  forecast_load_kwh_4h: z.number().nullable(),
  forecast_load_kwh_12h: z.number().nullable(),
  forecast_load_kwh_24h: z.number().nullable(),
  forecast_load_per_room_kwh: z.record(z.string(), z.number()),
  forecast_solar_per_room_kwh: z.record(z.string(), z.number()),
  hourly_temps_first_6: z.array(z.number()),
  hourly_solar_first_6: z.array(z.number()),
  cold_snap_active: z.boolean(),
  wind_active: z.boolean(),
})

export const PassiveRecoveryStateSchema = z.object({
  predicted_t_indoor: z.number(),
  composite_confidence: z.number(),
  weather_class: z.tuple([z.string(), z.string(), z.string()]).nullable(),
  bias_correction_c: z.number(),
  prediction_target_ts: z.number().nullable(),
})

export const PredictionRecordSchema = z.object({
  predicted_value: z.number(),
  predicted_metric: z.string(),
  prediction_target_ts: z.number(),
  decision_basis: z.record(z.string(), z.unknown()),
  decision_taken: z.string(),
})

export const AlarmEventSchema = z.object({
  alarm_id: z.enum(['A', 'B']),
  timestamp: z.number(),
  room: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  severity: z.literal('notification'),
})

export const FeatureFlagsResponseSchema = z.object({
  master_enable: z.boolean(),
  flags: z.record(z.string(), z.record(z.string(), z.boolean())),
  rooms: z.array(z.string()),
  deferred_enforcement_note: z.string(),
})

export const CutoverGateResultSchema = z.object({
  prediction_error_p95_c: z.number().nullable(),
  prediction_error_p95_threshold_c: z.number(),
  prediction_error_gate_pass: z.boolean(),
  comfort_excursions_attributable: z.number(),
  comfort_gate_pass: z.boolean(),
  c_maturity: z.number().nullable(),
  c_maturity_threshold: z.number(),
  c_historical_min_observed: z.number().nullable(),
  c_historical_threshold: z.number(),
  composite_confidence_gate_pass: z.boolean(),
  twin_drift_flagged: z.boolean(),
  twin_gate_pass: z.boolean(),
  all_gates_pass: z.boolean(),
  cycles_holding: z.number(),
  cycles_required: z.number(),
  cutover_eligible: z.boolean(),
  rationale: z.string(),
})

export const CutoverGatesResponseSchema = z.object({
  window_cycles: z.number(),
  cycles_required: z.number(),
  gates: z.record(z.string(), z.record(z.string(), CutoverGateResultSchema)),
})

export const FallbackCountsResponseSchema = z.object({
  fallback_counts: z.record(z.string(), z.number()),
})
