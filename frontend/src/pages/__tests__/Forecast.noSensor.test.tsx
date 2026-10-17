// INSTRUCTION-578 — the Forecast page shows the three installation load
// values as Unavailable, with one tooltip that names the zones with no
// configured temperature source, when the live snapshot has such a zone and
// the load values are null. The zones are named by their display label, in
// locale order; a zone with a configured sensor that is not reading is not
// named, because its source class is the class of its configuration.
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('../../hooks/useLive', () => ({
  useLive: () => ({
    data: {
      type: 'cycle',
      rooms: {
        study: {
          temp: null, target: 18, valve: 0, occupancy: 'unknown',
          temperature_source: 'none_configured', display_name: 'Study',
          status: 'idle', facing: 'E', area_m2: 9, ceiling_m: 2.4,
        },
        kitchen: {
          temp: null, target: 18, valve: 0, occupancy: 'unknown',
          temperature_source: 'none_configured', display_name: null,
          status: 'idle', facing: 'N', area_m2: 12, ceiling_m: 2.4,
        },
        hall: {
          temp: null, target: 18, valve: 0, occupancy: 'unknown',
          temperature_source: 'none_configured', display_name: 'Entrance Hall',
          status: 'idle', facing: 'N', area_m2: 8, ceiling_m: 2.4,
        },
        garage: {
          temp: null, target: 12, valve: 0, occupancy: 'unknown',
          temperature_source: 'independent', display_name: null,
          status: 'idle', facing: 'W', area_m2: 18, ceiling_m: 2.4,
        },
        living: {
          temp: 20.1, target: 21, valve: 40, occupancy: 'occupied',
          temperature_source: 'independent', display_name: null,
          status: 'heating', facing: 'S', area_m2: 24, ceiling_m: 2.4,
        },
      },
      forecast_state_snapshot: {
        oat_rise_next_6h_c: 2.5,
        solar_kwh_12h: 8.0,
        forecast_load_kwh_4h: null,
        forecast_load_kwh_12h: null,
        forecast_load_kwh_24h: null,
        forecast_load_per_room_kwh: {},
        forecast_solar_per_room_kwh: { living: 3.0 },
        hourly_temps_first_6: [3, 4, 5, 6, 7, 8],
        hourly_solar_first_6: [0.1, 0.3, 0.5, 0.7, 0.6, 0.4],
        cold_snap_active: false,
        wind_active: false,
      },
      passive_recovery: {},
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
        recovery_scheduler: { living: false, _global: false },
        rl: { living: false, _global: false },
      },
      rooms: ['living'],
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

describe('Forecast page — zones with no temperature source', () => {
  it('shows the three load values as Unavailable and names the zones with no configured source, by label and in locale order, in one tooltip', () => {
    render(<Forecast />)
    expect(screen.getAllByText('Unavailable')).toHaveLength(3)
    // The one tooltip sits in the Load 4h cell; the section heading has its
    // own help button, which is not the one under test.
    const cell = screen.getByText('Load 4h').parentElement
    if (cell === null) throw new Error('the Load 4h cell is not in the document')
    const help = within(cell).getAllByRole('button', { name: 'Help' })
    expect(help).toHaveLength(1)
    fireEvent.click(help[0])
    const tip = screen.getByRole('tooltip')
    // Locale order puts the key-derived lowercase label between the two
    // display names; code-unit order would put it last.
    expect(tip).toHaveTextContent('Zones with no sensor: Entrance Hall, kitchen, Study.')
    // The garage has a configured sensor that is not reading (temp null); its
    // class is the class of its configuration, so it is not a zone with no sensor.
    expect(tip).not.toHaveTextContent('garage')
  })
})
