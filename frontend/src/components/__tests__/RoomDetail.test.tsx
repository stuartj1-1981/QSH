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
