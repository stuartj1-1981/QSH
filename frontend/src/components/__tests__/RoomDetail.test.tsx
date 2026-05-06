import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoomDetail } from '../RoomDetail'

const baseRoom = {
  temp: 20.0,
  target: 21.0,
  valve: 50,
  occupancy: 'occupied' as const,
  status: 'heating',
  facing: 0.5,
  area_m2: 20,
  ceiling_m: 2.4,
}

const noop = () => {}

describe('RoomDetail sensor unavailable explanation', () => {
  it('shows explanatory text when occupancy_source includes "unavailable"', () => {
    render(
      <RoomDetail
        name="lounge"
        room={{ ...baseRoom, occupancy_source: 'schedule (sensor unavailable)' }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.getByText(/Occupancy sensor is not responding/)).toBeDefined()
    expect(screen.getByText(/Using your saved schedule/)).toBeDefined()
  })

  it('does not show explanatory text when sensor is healthy', () => {
    render(
      <RoomDetail
        name="lounge"
        room={{ ...baseRoom, occupancy_source: 'sensor' }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.queryByText(/Occupancy sensor is not responding/)).toBeNull()
  })

  it('does not show explanatory text when no occupancy_source', () => {
    render(
      <RoomDetail
        name="lounge"
        room={baseRoom}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.queryByText(/Occupancy sensor is not responding/)).toBeNull()
  })
})

describe('RoomDetail temperature source row', () => {
  it('renders "None — schedule only" for none_configured rooms', () => {
    render(
      <RoomDetail
        name="utility"
        room={{ ...baseRoom, temperature_source: 'none_configured' }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.getByText('None — schedule only')).toBeInTheDocument()
  })

  it('renders "Independent sensor" for independent rooms', () => {
    render(
      <RoomDetail
        name="lounge"
        room={{ ...baseRoom, temperature_source: 'independent' }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.getByText('Independent sensor')).toBeInTheDocument()
  })
})


// =============================================================================
// INSTRUCTION-172 — fixed_setpoint annotation on the target line
// =============================================================================


describe('RoomDetail fixed_setpoint annotation', () => {
  const sysidBase = {
    u_kw_per_c: 0.05,
    c_kwh_per_c: 0.5,
    u_observations: 100,
    c_observations: 50,
    c_source: 'measured' as const,
    pc_fits: 5,
    solar_gain: 0.0,
    confidence: 'high' as const,
  }

  it('renders "(fixed)" annotation when sysid.fixed_setpoint is set', () => {
    render(
      <RoomDetail
        name="spare"
        room={baseRoom}
        sysid={{ ...sysidBase, fixed_setpoint: 19.0 }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.getByTestId('fixed-target-annotation')).toBeInTheDocument()
    expect(screen.getByText('(fixed)')).toBeInTheDocument()
  })

  it('omits "(fixed)" annotation when sysid.fixed_setpoint is null', () => {
    render(
      <RoomDetail
        name="spare"
        room={baseRoom}
        sysid={{ ...sysidBase, fixed_setpoint: null }}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.queryByTestId('fixed-target-annotation')).toBeNull()
  })

  it('omits "(fixed)" annotation when sysid is not provided', () => {
    render(
      <RoomDetail
        name="lounge"
        room={baseRoom}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.queryByTestId('fixed-target-annotation')).toBeNull()
  })

  it('omits "(fixed)" annotation when sysid omits fixed_setpoint key', () => {
    render(
      <RoomDetail
        name="lounge"
        room={baseRoom}
        sysid={sysidBase}
        engineering={false}
        onClose={noop}
      />
    )
    expect(screen.queryByTestId('fixed-target-annotation')).toBeNull()
  })
})
