import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeatLossSummary } from '../HeatLossSummary'
import type { InstallationHeatLoss, SysidRoom } from '../../types/api'

// INSTRUCTION-614 — the whole-house heat loss coefficient card.

function room(u: number, prior: number | null, ratio: number | null, uObs: number): SysidRoom {
  return {
    u_kw_per_c: u,
    c_kwh_per_c: 0.5,
    u_observations: uObs,
    c_observations: 0,
    c_source: 'prior',
    pc_fits: 0,
    solar_gain: 0,
    confidence: 'medium',
    u_prior_kw_per_c: prior,
    u_vs_design: ratio,
  }
}

const SUMMARY: InstallationHeatLoss = {
  u_learned_kw_per_c: 0.4,
  u_design_kw_per_c: 0.2,
  ratio: 2.0,
  design_loss_kw: 4.8,
  design_delta_c: 24.0,
  learned_loss_at_design_kw: 9.6,
  rooms_total: 3,
  rooms_learned: 3,
  rooms_above_cap: 1,
  cap_mult: 2.5,
}

const ROOMS: Record<string, SysidRoom> = {
  bed_1: room(0.1, 0.1, 1.0, 50),
  lounge: room(0.3, 0.1, 3.0, 50),
  hall: room(0.05, 0.05, 1.0, 4),
}

describe('HeatLossSummary', () => {
  it('renders the house totals, the ratio and the loss at design', () => {
    render(<HeatLossSummary summary={SUMMARY} rooms={ROOMS} />)
    expect(screen.getByTestId('hl-learned').textContent).toBe('0.400 kW/°C')
    expect(screen.getByTestId('hl-design').textContent).toBe('0.200 kW/°C')
    expect(screen.getByTestId('hl-ratio').textContent).toBe('2.00×')
    expect(screen.getByTestId('hl-loss').textContent).toBe('9.6 kW / 4.8 kW')
    expect(screen.getByTestId('hl-rooms').textContent).toBe('3 of 3')
  })

  it('renders a dash for each total that is null', () => {
    const empty: InstallationHeatLoss = {
      ...SUMMARY,
      u_learned_kw_per_c: null,
      u_design_kw_per_c: null,
      ratio: null,
      design_loss_kw: null,
      design_delta_c: null,
      learned_loss_at_design_kw: null,
    }
    render(<HeatLossSummary summary={empty} rooms={{}} />)
    expect(screen.getByTestId('hl-learned').textContent).toBe('—')
    expect(screen.getByTestId('hl-ratio').textContent).toBe('—')
    expect(screen.getByTestId('hl-loss').textContent).toBe('— / —')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows the design values and no ratio while a room is at its prior', () => {
    const partial = { ...SUMMARY, ratio: null, learned_loss_at_design_kw: null, rooms_learned: 2 }
    render(<HeatLossSummary summary={partial} rooms={ROOMS} />)
    expect(screen.getByTestId('hl-learned').textContent).toBe('0.400 kW/°C')
    expect(screen.getByTestId('hl-design').textContent).toBe('0.200 kW/°C')
    expect(screen.getByTestId('hl-ratio').textContent).toBe('—')
    expect(screen.getByTestId('hl-loss').textContent).toBe('— / 4.8 kW')
    expect(screen.getByTestId('hl-rooms').textContent).toBe('2 of 3')
  })

  it('lists the rooms highest ratio first and leaves out a room with no ratio', () => {
    const rooms = { ...ROOMS, store: room(0.02, null, null, 50) }
    render(<HeatLossSummary summary={SUMMARY} rooms={rooms} />)
    const ids = screen.getAllByTestId(/^hl-row-/).map((el) => el.getAttribute('data-testid'))
    expect(ids[0]).toBe('hl-row-lounge')
    expect(ids).toHaveLength(3)
    expect(ids).not.toContain('hl-row-store')
  })

  it('flags a room above the cap and a room still at its prior', () => {
    const partial: InstallationHeatLoss = { ...SUMMARY, ratio: null, learned_loss_at_design_kw: null, rooms_learned: 2 }
    render(<HeatLossSummary summary={partial} rooms={ROOMS} />)
    expect(screen.getByTestId('hl-row-lounge').textContent).toContain('above 2.5× cap')
    expect(screen.getByTestId('hl-row-hall').textContent).toContain('at prior')
    expect(screen.getByTestId('hl-row-bed_1').textContent).not.toContain('above')
    expect(screen.getByTestId('hl-row-bed_1').textContent).not.toContain('at prior')
  })
})
