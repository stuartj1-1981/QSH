import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ForecastStatePanel } from '../forecast/ForecastStatePanel'
import type { ForecastStateSnapshot } from '../../types/api'

// Recharts measures parent dimensions at runtime — in jsdom the parent is
// 0x0 so the chart subtree never mounts and Tooltip never appears in the
// DOM. Mock ResponsiveContainer + LineChart with passthroughs that render
// their children, and stub Tooltip / Line with marker elements so the
// INSTRUCTION-227A Task 2 presence assertion can fire.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="rc-responsive-container" style={{ width: 400, height: 60 }}>{children}</div>
    ),
    LineChart: ({ children }: { children: React.ReactNode }) => (
      <div className="recharts-wrapper">{children}</div>
    ),
    Tooltip: () => <div className="recharts-tooltip-wrapper" />,
    Line: () => null,
  }
})

const _full_state: ForecastStateSnapshot = {
  oat_rise_next_6h_c: 2.3,
  solar_kwh_12h: 5.4,
  forecast_load_kwh_4h: 8.2,
  forecast_load_kwh_12h: 24.6,
  forecast_load_kwh_24h: 48.0,
  forecast_load_per_room_kwh: {},
  forecast_solar_per_room_kwh: {},
  hourly_temps_first_6: [5, 6, 7, 8, 9, 10],
  hourly_solar_first_6: [0.1, 0.2, 0.3, 0.4, 0.3, 0.2],
  cold_snap_active: false,
  wind_active: false,
}

describe('ForecastStatePanel', () => {
  it('renders 5 KPI cards from valid state', () => {
    render(<ForecastStatePanel state={_full_state} />)
    expect(screen.getByText('2.3°C')).toBeInTheDocument()
    expect(screen.getByText('5.4 kWh')).toBeInTheDocument()
    expect(screen.getByText('8.2 kWh')).toBeInTheDocument()
  })

  it('renders not-yet-available when state undefined', () => {
    render(<ForecastStatePanel state={undefined} />)
    expect(screen.getByText(/not yet available/)).toBeInTheDocument()
  })

  it('renders null values as "—"', () => {
    const partial: ForecastStateSnapshot = {
      ..._full_state,
      oat_rise_next_6h_c: null,
      solar_kwh_12h: null,
    }
    render(<ForecastStatePanel state={partial} />)
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  // INSTRUCTION-578 — the three load values are unavailable, not pending,
  // when every one is null and a zone has no temperature source. One tooltip
  // names the zones.
  const _no_load: ForecastStateSnapshot = {
    ..._full_state,
    forecast_load_kwh_4h: null,
    forecast_load_kwh_12h: null,
    forecast_load_kwh_24h: null,
  }

  it('renders the three load values as Unavailable, with one tooltip that names the zones with no sensor', () => {
    render(<ForecastStatePanel state={_no_load} zonesWithNoSensor={['hall', 'utility room']} />)
    expect(screen.getAllByText('Unavailable')).toHaveLength(3)
    expect(screen.queryByText('—')).not.toBeInTheDocument()
    const help = screen.getAllByRole('button', { name: 'Help' })
    expect(help).toHaveLength(1)
    fireEvent.click(help[0])
    // Equality, not containment: the whole text and nothing more.
    expect(screen.getByRole('tooltip').textContent).toBe(
      'The load values need a temperature sensor in every zone. ' +
      'Zones with no sensor: hall, utility room. ' +
      'Give each zone a temperature sensor, or remove the zone from the configuration, to get the load values.',
    )
  })

  it('renders a null load value as "—" with no tooltip when another load value is a number, also when a zone has no sensor', () => {
    const mixed: ForecastStateSnapshot = { ..._full_state, forecast_load_kwh_12h: null, forecast_load_kwh_24h: null }
    render(<ForecastStatePanel state={mixed} zonesWithNoSensor={['hall']} />)
    expect(screen.getByText('8.2 kWh')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument()
  })

  it('renders null load values as "—" with no tooltip when every zone has a sensor', () => {
    render(<ForecastStatePanel state={_no_load} zonesWithNoSensor={[]} />)
    expect(screen.getAllByText('—')).toHaveLength(3)
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument()
  })

  it('renders numeric load values as numbers with no tooltip, also when a zone has no sensor', () => {
    render(<ForecastStatePanel state={_full_state} zonesWithNoSensor={['hall']} />)
    expect(screen.getByText('8.2 kWh')).toBeInTheDocument()
    expect(screen.getByText('24.6 kWh')).toBeInTheDocument()
    expect(screen.getByText('48.0 kWh')).toBeInTheDocument()
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument()
  })

  it('renders cold-snap badge when active', () => {
    const cold: ForecastStateSnapshot = { ..._full_state, cold_snap_active: true }
    render(<ForecastStatePanel state={cold} />)
    expect(screen.getByText(/Cold snap/)).toBeInTheDocument()
  })

  // INSTRUCTION-227A Task 2 — both mini-charts must mount a Recharts Tooltip
  // when their data array is non-empty. The Tooltip wrapper is created in the
  // DOM regardless of hover state (visibility is toggled via inline style on
  // hover), so a class-based query is sufficient.
  it('mounts Recharts Tooltip wrappers for OAT and solar mini-charts', () => {
    const { container } = render(<ForecastStatePanel state={_full_state} />)
    const tooltips = container.querySelectorAll('.recharts-tooltip-wrapper')
    expect(tooltips.length).toBe(2)
  })
})
