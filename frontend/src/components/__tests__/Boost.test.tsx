import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoomCard } from '../RoomCard'
import { StatusBanner } from '../StatusBanner'

describe('RoomCard boost indicator', () => {
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

  it('renders boost indicator when boost active', () => {
    render(
      <RoomCard
        name="lounge"
        room={baseRoom}
        boost={{ target: 24.0, remaining_s: 1800, original_target: 21.0 }}
      />
    )
    // Should show boost countdown
    expect(screen.getByText(/Boost 30m/)).toBeDefined()
    // Should show boost target
    expect(screen.getByText(/24\.0/)).toBeDefined()
  })

  it('renders normal status when no boost', () => {
    render(<RoomCard name="lounge" room={baseRoom} />)
    expect(screen.getByText('heating')).toBeDefined()
    expect(screen.queryByText(/Boost/)).toBeNull()
  })

  it('shows flame icon styling when boost active', () => {
    const { container } = render(
      <RoomCard
        name="lounge"
        room={baseRoom}
        boost={{ target: 24.0, remaining_s: 900, original_target: 21.0 }}
      />
    )
    // Check for orange border styling
    const button = container.querySelector('button')
    expect(button?.className).toContain('border-orange')
  })
})

describe('StatusBanner boost indicator', () => {
  it('shows boost indicator when active', () => {
    render(
      <StatusBanner
        operatingState="Shoulder (Heating)"
        controlEnabled={true}
        appliedFlow={35}
        appliedMode="heat"
        outdoorTemp={4}
        heatSource={{
          type: 'heat_pump',
          input_power_kw: 2.0,
          thermal_output_kw: 7.0,
          thermal_output_source: 'measured',
          performance: { value: 3.5, source: 'live' },
          flow_temp: 35,
          return_temp: 30,
          delta_t: 5,
          flow_rate: 0.3,
        }}
        boostActive={true}
        boostRoomCount={2}
      />
    )
    expect(screen.getByText(/Boost \(2\)/)).toBeDefined()
  })

  it('hides boost indicator when inactive', () => {
    render(
      <StatusBanner
        operatingState="Shoulder (Heating)"
        controlEnabled={true}
        appliedFlow={35}
        appliedMode="heat"
        outdoorTemp={4}
        heatSource={{
          type: 'heat_pump',
          input_power_kw: 2.0,
          thermal_output_kw: 7.0,
          thermal_output_source: 'measured',
          performance: { value: 3.5, source: 'live' },
          flow_temp: 35,
          return_temp: 30,
          delta_t: 5,
          flow_rate: 0.3,
        }}
        boostActive={false}
        boostRoomCount={0}
      />
    )
    expect(screen.queryByText(/Boost/)).toBeNull()
  })
})
