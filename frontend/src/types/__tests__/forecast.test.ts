import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  ForecastStateSnapshotSchema,
  PassiveRecoveryStateSchema,
  PredictionRecordSchema,
  AlarmEventSchema,
  FeatureFlagsResponseSchema,
  CutoverGatesResponseSchema,
} from '../forecastSchemas'

describe('Forecast Extension runtime schema validation', () => {
  it('ForecastStateSnapshotSchema parses valid 208A payload', () => {
    const valid = {
      oat_rise_next_6h_c: 2.5,
      solar_kwh_12h: 8.0,
      forecast_load_kwh_4h: 5.0,
      forecast_load_kwh_12h: 15.0,
      forecast_load_kwh_24h: 28.0,
      forecast_load_per_room_kwh: { living: 8.0 },
      forecast_solar_per_room_kwh: { living: 3.0 },
      hourly_temps_first_6: [3, 4, 5, 6, 7, 8],
      hourly_solar_first_6: [0.1, 0.3, 0.5, 0.7, 0.6, 0.4],
      cold_snap_active: false,
      wind_active: false,
    }
    const parsed = ForecastStateSnapshotSchema.parse(valid)
    expect(parsed.oat_rise_next_6h_c).toBe(2.5)
    expect(parsed.cold_snap_active).toBe(false)
  })

  it('PassiveRecoveryStateSchema parses with weather_class as 3-tuple', () => {
    const valid = {
      predicted_t_indoor: 20.5,
      composite_confidence: 0.7,
      weather_class: ['cold', 'low', 'calm'],
      bias_correction_c: 0.2,
      prediction_target_ts: 1747526400,
    }
    const parsed = PassiveRecoveryStateSchema.parse(valid)
    expect(parsed.weather_class).toEqual(['cold', 'low', 'calm'])
  })

  it('AlarmEventSchema parses a valid notification event', () => {
    const valid = {
      alarm_id: 'A',
      timestamp: 1747526400,
      room: 'living',
      payload: { reason: 'persistent_breach' },
      severity: 'notification',
    }
    const parsed = AlarmEventSchema.parse(valid)
    expect(parsed.severity).toBe('notification')
    expect(parsed.alarm_id).toBe('A')
  })

  it('AlarmEventSchema REJECTS severity values other than "notification"', () => {
    const malformed = {
      alarm_id: 'A',
      timestamp: 1747526400,
      room: 'living',
      payload: {},
      severity: 'critical',
    }
    expect(() => AlarmEventSchema.parse(malformed)).toThrow(z.ZodError)
  })

  it('AlarmEventSchema REJECTS alarm_id values other than "A" or "B"', () => {
    const malformed = {
      alarm_id: 'C',
      timestamp: 1747526400,
      room: 'living',
      payload: {},
      severity: 'notification',
    }
    expect(() => AlarmEventSchema.parse(malformed)).toThrow(z.ZodError)
  })

  it('FeatureFlagsResponseSchema REJECTS missing deferred_enforcement_note', () => {
    const malformed = {
      master_enable: false,
      flags: {},
      rooms: [],
    }
    expect(() => FeatureFlagsResponseSchema.parse(malformed)).toThrow(z.ZodError)
  })

  it('PredictionRecordSchema REJECTS predicted_value as string', () => {
    const malformed = {
      predicted_value: 'twenty-point-five',
      predicted_metric: 'T_indoor_living',
      prediction_target_ts: 1747526400,
      decision_basis: {},
      decision_taken: 'suppress_recovery_start',
    }
    expect(() => PredictionRecordSchema.parse(malformed)).toThrow(z.ZodError)
  })

  it('CutoverGatesResponseSchema parses nested per-(controller, scope) structure', () => {
    const valid = {
      window_cycles: 168,
      cycles_required: 168,
      gates: {
        rl: {
          _global: {
            prediction_error_p95_c: 0.5,
            prediction_error_p95_threshold_c: 1.0,
            prediction_error_gate_pass: true,
            comfort_excursions_attributable: 0,
            comfort_gate_pass: true,
            c_maturity: 0.85,
            c_maturity_threshold: 0.7,
            c_historical_min_observed: 0.6,
            c_historical_threshold: 0.5,
            composite_confidence_gate_pass: true,
            twin_drift_flagged: false,
            twin_gate_pass: true,
            all_gates_pass: true,
            cycles_holding: 50,
            cycles_required: 168,
            cutover_eligible: false,
            rationale: 'All gates passing. Cycles held: 50/168.',
          },
        },
      },
    }
    const parsed = CutoverGatesResponseSchema.parse(valid)
    expect(parsed.gates['rl']['_global'].cycles_holding).toBe(50)
  })
})
