import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBanner } from '../StatusBanner'

const baseProps = {
  operatingState: 'Winter (Heating)',
  controlEnabled: true,
  appliedFlow: 40,
  appliedMode: 'winter',
  outdoorTemp: 5.0,
  hpPowerKw: 3.5,
  hpCop: 3.2,
}

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

describe('StatusBanner sensor fallback warning', () => {
  it('renders fallback warning when rooms have unavailable sensors', () => {
    render(
      <StatusBanner
        {...baseProps}
        rooms={{
          lounge: { ...baseRoom, occupancy_source: 'schedule (sensor unavailable)' },
          bedroom: { ...baseRoom, occupancy_source: 'sensor' },
        }}
      />
    )
    expect(screen.getByText(/Occupancy sensor unavailable/)).toBeDefined()
    expect(screen.getByText(/lounge/)).toBeDefined()
  })

  it('does not render fallback warning when all sensors healthy', () => {
    render(
      <StatusBanner
        {...baseProps}
        rooms={{
          lounge: { ...baseRoom, occupancy_source: 'sensor' },
          bedroom: { ...baseRoom, occupancy_source: 'schedule' },
        }}
      />
    )
    expect(screen.queryByText(/Occupancy sensor unavailable/)).toBeNull()
  })

  it('does not render fallback warning when no rooms provided', () => {
    render(<StatusBanner {...baseProps} />)
    expect(screen.queryByText(/Occupancy sensor unavailable/)).toBeNull()
  })

  it('shows multiple room names when multiple sensors unavailable', () => {
    render(
      <StatusBanner
        {...baseProps}
        rooms={{
          lounge: { ...baseRoom, occupancy_source: 'schedule (sensor unavailable)' },
          bedroom: { ...baseRoom, occupancy_source: 'last_known (sensor unavailable)' },
        }}
      />
    )
    expect(screen.getByText(/lounge/)).toBeDefined()
    expect(screen.getByText(/bedroom/)).toBeDefined()
  })
})
