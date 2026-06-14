/**
 * INSTRUCTION-321B — StatusBanner apoptosis / hormesis banner render.
 * The suspension banner appears only when apoptosis.suspended is true; the
 * hormesis banner only at 2-of-3 (and not while suspended). Absent / all-false
 * renders nothing apoptosis-related.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBanner } from '../StatusBanner'
import type { HeatSourceState, ApoptosisStatus } from '../../types/api'

const heatSource: HeatSourceState = {
  type: 'heat_pump',
  input_power_kw: 2.1,
  thermal_output_kw: 7.56,
  thermal_output_source: 'measured',
  performance: { value: 3.6, source: 'live' },
  flow_temp: 40,
  return_temp: 35,
  delta_t: 5,
  flow_rate: 0.38,
}

const baseProps = {
  operatingState: 'Heating',
  controlEnabled: true,
  appliedFlow: 40,
  appliedMode: 'heat',
  outdoorTemp: 5,
  heatSource,
}

function status(over: Partial<ApoptosisStatus>): ApoptosisStatus {
  return {
    known: true, hormesis: false, armed: false, suspended: false, enabled: true,
    trigger_a: false, trigger_b: false, trigger_c: false, ...over,
  }
}

describe('StatusBanner — apoptosis', () => {
  it('renders the suspension banner when suspended', () => {
    render(<StatusBanner {...baseProps} apoptosis={status({ suspended: true, armed: true })} />)
    expect(screen.getByTestId('apoptosis-banner')).toBeDefined()
    expect(screen.getByText(/self-suspended from the swarm/i)).toBeDefined()
  })

  it('renders the hormesis banner at 2-of-3', () => {
    render(<StatusBanner {...baseProps} apoptosis={status({ hormesis: true })} />)
    expect(screen.getByTestId('hormesis-banner')).toBeDefined()
    expect(screen.getByText(/2 of 3 apoptosis conditions/i)).toBeDefined()
  })

  it('suppresses the hormesis banner while suspended', () => {
    render(<StatusBanner {...baseProps} apoptosis={status({ hormesis: true, suspended: true })} />)
    expect(screen.getByTestId('apoptosis-banner')).toBeDefined()
    expect(screen.queryByTestId('hormesis-banner')).toBeNull()
  })

  it('renders nothing apoptosis-related when all-false', () => {
    render(<StatusBanner {...baseProps} apoptosis={status({})} />)
    expect(screen.queryByTestId('apoptosis-banner')).toBeNull()
    expect(screen.queryByTestId('hormesis-banner')).toBeNull()
  })

  it('renders nothing when the prop is omitted', () => {
    render(<StatusBanner {...baseProps} />)
    expect(screen.queryByTestId('apoptosis-banner')).toBeNull()
    expect(screen.queryByTestId('hormesis-banner')).toBeNull()
  })
})
