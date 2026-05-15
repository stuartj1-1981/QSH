import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
