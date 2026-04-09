import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoomCard } from '../RoomCard'

describe('RoomCard occupancy source icon', () => {
  const baseRoom = {
    temp: 20.0,
    target: 21.0,
    valve: 50,
    occupancy: 'occupied',
    status: 'heating',
    facing: 0.5,
    area_m2: 20,
    ceiling_m: 2.4,
  }

  it('renders occupancy text correctly', () => {
    render(<RoomCard name="lounge" room={baseRoom} />)
    expect(screen.getByText('occupied')).toBeDefined()
  })

  it('renders with sensor source', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, occupancy_source: 'sensor' }}
      />
    )
    expect(screen.getByText('occupied')).toBeDefined()
  })

  it('renders with schedule source (default)', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, occupancy_source: 'schedule' }}
      />
    )
    expect(screen.getByText('occupied')).toBeDefined()
  })

  it('renders with unavailable source', () => {
    render(
      <RoomCard
        name="lounge"
        room={{ ...baseRoom, occupancy_source: 'schedule (sensor unavailable)' }}
      />
    )
    expect(screen.getByText('occupied')).toBeDefined()
  })

  it('renders without occupancy_source (undefined)', () => {
    render(<RoomCard name="lounge" room={baseRoom} />)
    expect(screen.getByText('occupied')).toBeDefined()
  })
})
