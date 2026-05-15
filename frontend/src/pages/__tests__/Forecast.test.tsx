import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../hooks/useLive', () => ({
  useLive: () => ({
    data: {
      type: 'cycle',
      forecast_state_snapshot: {
        oat_rise_next_6h_c: 2.5,
        solar_kwh_12h: 8.0,
        forecast_load_kwh_4h: 5.0,
        forecast_load_kwh_12h: 15.0,
        forecast_load_kwh_24h: 28.0,
        forecast_load_per_room_kwh: { living: 8.0, bedroom: 6.0 },
        forecast_solar_per_room_kwh: { living: 3.0, bedroom: 1.0 },
        hourly_temps_first_6: [3, 4, 5, 6, 7, 8],
        hourly_solar_first_6: [0.1, 0.3, 0.5, 0.7, 0.6, 0.4],
        cold_snap_active: false,
        wind_active: false,
      },
      passive_recovery: {
        living: {
          predicted_t_indoor: 20.5,
          composite_confidence: 0.7,
          weather_class: ['cold', 'low', 'calm'],
          bias_correction_c: 0.2,
          prediction_target_ts: 1747526400,
        },
      },
      forecast_predicted_decisions: {},
      twin_calibration_drift: {},
      active_alarms: [],
    },
    isConnected: true,
    lastUpdate: 100,
    disconnectedSince: null,
  }),
}))

vi.mock('../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({
    data: {
      master_enable: true,
      flags: {
        recovery_scheduler: { living: false, bedroom: false, _global: false },
        rl: { living: false, bedroom: false, _global: false },
      },
      rooms: ['living', 'bedroom'],
      deferred_enforcement_note: 'deferred...',
    },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('../../hooks/useCutoverGates', () => ({
  useCutoverGates: () => ({ data: null, loading: false, error: null, refetch: vi.fn() }),
}))

vi.mock('../../hooks/useFallbackCounts', () => ({
  useFallbackCounts: () => ({ data: null, loading: false, error: null, refetch: vi.fn() }),
}))

vi.mock('../../hooks/useAlarms', () => ({
  useAlarms: () => ({ liveAlarms: [], historicalAlarms: [], loading: false, error: null }),
}))

vi.mock('../../hooks/useReconciliation', () => ({
  useReconciliation: () => ({ points: [], loading: false, error: null }),
}))

vi.mock('../../hooks/useHistorian', () => ({
  useHistorianQuery: () => ({ data: null, loading: false, error: null, refetch: vi.fn() }),
}))

import { Forecast } from '../Forecast'

describe('Forecast page', () => {
  it('renders without crashing', () => {
    render(<Forecast />)
    expect(screen.getByText('Forecast Extension')).toBeInTheDocument()
  })

  it('renders 6 sections numbered sequentially 1-6 (INSTRUCTION-227A Task 1)', () => {
    render(<Forecast />)
    expect(screen.getByTestId('view-1-forecast-state')).toBeInTheDocument()
    expect(screen.getByTestId('view-2-passive-recovery')).toBeInTheDocument()
    expect(screen.getByTestId('view-3-blend-evolution')).toBeInTheDocument()
    expect(screen.getByTestId('view-4-cutover-gates')).toBeInTheDocument()
    expect(screen.getByTestId('view-5-reconciliation')).toBeInTheDocument()
    expect(screen.getByTestId('view-6-alarms')).toBeInTheDocument()
    // Legacy IDs from the pre-227A numbering must NOT be present.
    expect(screen.queryByTestId('view-4-feature-flags')).toBeNull()
    expect(screen.queryByTestId('view-5-cutover-gates')).toBeNull()
    expect(screen.queryByTestId('view-6-reconciliation')).toBeNull()
    expect(screen.queryByTestId('view-7-alarms')).toBeNull()
  })

  it('does NOT render the legacy estimator literature term anywhere on the page', () => {
    render(<Forecast />)
    const LEGACY_TOKEN = 'doub' + 'ly_robust'
    expect(screen.queryByText(new RegExp(LEGACY_TOKEN, 'i'))).toBeNull()
  })

  it('does not render any INSTRUCTION-NNN reference in user-visible copy', () => {
    const { container } = render(<Forecast />)
    // Match against `container.textContent` rather than `screen.queryByText`
    // so the regex can span adjacent text nodes. A naive
    // `queryByText(/INSTRUCTION-\d/)` only matches within a single text node
    // and would silently pass a regression that split the token across two
    // JSX nodes (e.g. <span>INSTRUCTION-</span>{ver}). V2 reviewer LOW.
    expect(container.textContent ?? '').not.toMatch(/INSTRUCTION-\d/)
  })

  it('page strapline is plain-English (no DFAN jargon, no overstated claim)', () => {
    const { container } = render(<Forecast />)
    expect(screen.queryByText(/DFAN/)).toBeNull()
    expect(screen.queryByText(/design-mandated/)).toBeNull()
    // Presence check on the load-bearing phrase — the prefix alone
    // ("Settings, status, and learning progress") passes against both the
    // intended copy and the V1 over-claim copy, so it cannot catch a
    // regression of the V1 MEDIUM defect. Pair the prefix presence-check
    // with a positive presence-check on the load-bearing word and an
    // absence-check on the over-claim word. V3 reviewer LOW.
    expect(screen.getByText(/Settings, status, and learning progress/)).toBeInTheDocument()
    expect(screen.getByText(/forecast-aware heating decisions/)).toBeInTheDocument()
    expect(container.textContent ?? '').not.toMatch(/forecast-driven/)
  })
})
