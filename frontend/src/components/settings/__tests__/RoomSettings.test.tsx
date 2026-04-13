import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoomSettings } from '../RoomSettings'

// Mock the hooks
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: vi.fn(), saving: false }),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {} }),
}))

describe('RoomSettings occupancy sensor', () => {
  const baseRooms = {
    lounge: {
      area_m2: 20,
      facing: 'S',
      ceiling_m: 2.4,
      occupancy_sensor: 'binary_sensor.lounge_presence',
    },
    bedroom: {
      area_m2: 15,
      facing: 'N',
      ceiling_m: 2.4,
    },
  }

  it('renders occupancy sensor EntityField', () => {
    render(<RoomSettings rooms={baseRooms} driver="ha" onRefetch={() => {}} />)
    const labels = screen.getAllByText('Occupancy Sensor')
    expect(labels.length).toBeGreaterThan(0)
  })

  it('renders debounce input for all rooms', () => {
    render(<RoomSettings rooms={baseRooms} driver="ha" onRefetch={() => {}} />)
    const debounceLabels = screen.getAllByText('Debounce (s)')
    // Debounce field is always visible alongside occupancy sensor field
    expect(debounceLabels.length).toBe(2)
  })

  it('renders debounce input even without sensor', () => {
    const roomsNoSensor = {
      bedroom: { area_m2: 15, facing: 'N', ceiling_m: 2.4 },
    }
    render(<RoomSettings rooms={roomsNoSensor} driver="ha" onRefetch={() => {}} />)
    expect(screen.queryByText('Debounce (s)')).not.toBeNull()
  })

  it('shows fallback dropdown when occupancy_sensor is set', () => {
    render(<RoomSettings rooms={baseRooms} driver="ha" onRefetch={() => {}} />)
    // Lounge has occupancy_sensor set, so fallback dropdown should be visible
    const fallbackLabels = screen.getAllByText('Sensor Unavailable Behaviour')
    expect(fallbackLabels.length).toBe(1) // Only lounge has a sensor
  })

  it('hides fallback dropdown when occupancy_sensor is absent', () => {
    const roomsNoSensor = {
      bedroom: { area_m2: 15, facing: 'N', ceiling_m: 2.4 },
    }
    render(<RoomSettings rooms={roomsNoSensor} driver="ha" onRefetch={() => {}} />)
    expect(screen.queryByText('Sensor Unavailable Behaviour')).toBeNull()
  })

  it('shows watchdog timeout only when last_known is selected', () => {
    const roomsLastKnown = {
      lounge: {
        area_m2: 20,
        facing: 'S',
        ceiling_m: 2.4,
        occupancy_sensor: 'binary_sensor.lounge_presence',
        occupancy_fallback: 'last_known' as const,
        last_known_timeout_s: 3600,
      },
    }
    render(<RoomSettings rooms={roomsLastKnown} driver="ha" onRefetch={() => {}} />)
    expect(screen.queryByText('Watchdog timeout (min)')).not.toBeNull()
  })

  it('hides watchdog timeout when schedule fallback is selected', () => {
    render(<RoomSettings rooms={baseRooms} driver="ha" onRefetch={() => {}} />)
    expect(screen.queryByText('Watchdog timeout (min)')).toBeNull()
  })
})
