import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockPatch = vi.fn().mockResolvedValue({ updated: 'rooms', restart_required: false, message: '' })
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: mockPatch, saving: false, error: null }),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {}, loading: false }),
}))

import { RoomSettings } from '../RoomSettings'

const noop = () => {}

describe('RoomSettings driver branching', () => {
  const mqttRoom = {
    area_m2: 20,
    facing: 'S',
    ceiling_m: 2.4,
    mqtt_topics: {
      room_temp: 'rooms/lounge/temp',
      valve_position: 'rooms/lounge/valve',
      valve_setpoint: 'rooms/lounge/valve/set',
      trv_setpoint: 'rooms/lounge/setpoint',
      occupancy_sensor: 'rooms/lounge/occupancy',
    },
  }

  const haRoom = {
    area_m2: 20,
    facing: 'S',
    ceiling_m: 2.4,
    trv_entity: 'climate.lounge_trv',
    independent_sensor: 'sensor.lounge_temp',
    heating_entity: 'binary_sensor.lounge_heating',
    occupancy_sensor: 'binary_sensor.lounge_presence',
  }

  it('MQTT driver: renders 5 TopicField instances', () => {
    render(<RoomSettings rooms={{ lounge: mqttRoom }} driver="mqtt" onRefetch={noop} />)
    expect(screen.getByText('Room Temp Topic')).toBeInTheDocument()
    expect(screen.getByText('Valve Position Topic')).toBeInTheDocument()
    expect(screen.getByText('Valve Setpoint Topic')).toBeInTheDocument()
    expect(screen.getByText('TRV Setpoint Topic')).toBeInTheDocument()
    expect(screen.getByText('Occupancy Topic')).toBeInTheDocument()
  })

  it('MQTT driver: HA-only rows absent', () => {
    render(<RoomSettings rooms={{ lounge: mqttRoom }} driver="mqtt" onRefetch={noop} />)
    expect(screen.queryByText('TRV Entity')).toBeNull()
    expect(screen.queryByText('Temp Sensor')).toBeNull()
    expect(screen.queryByText('Heating Entity')).toBeNull()
  })

  it('MQTT driver: displays topic values', () => {
    render(<RoomSettings rooms={{ lounge: mqttRoom }} driver="mqtt" onRefetch={noop} />)
    expect(screen.getByDisplayValue('rooms/lounge/temp')).toBeInTheDocument()
    expect(screen.getByDisplayValue('rooms/lounge/valve')).toBeInTheDocument()
  })

  it('MQTT driver: save carries mqtt_topics in PATCH payload', async () => {
    mockPatch.mockClear()
    render(<RoomSettings rooms={{ lounge: mqttRoom }} driver="mqtt" onRefetch={noop} />)

    // Edit room temp topic
    const tempInput = screen.getByDisplayValue('rooms/lounge/temp')
    fireEvent.change(tempInput, { target: { value: 'rooms/lounge/temperature' } })

    // Save
    fireEvent.click(screen.getByText('Save Changes'))

    await vi.waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('rooms', expect.objectContaining({
        lounge: expect.objectContaining({
          mqtt_topics: expect.objectContaining({
            room_temp: 'rooms/lounge/temperature',
          }),
        }),
      }))
    })
  })

  it('HA driver: renders entity fields, no topic fields', () => {
    render(<RoomSettings rooms={{ lounge: haRoom }} driver="ha" onRefetch={noop} />)
    expect(screen.getByText('TRV Entity')).toBeInTheDocument()
    expect(screen.getByText('Temp Sensor')).toBeInTheDocument()
    expect(screen.getByText('Heating Entity')).toBeInTheDocument()
    expect(screen.getByText('Occupancy Sensor')).toBeInTheDocument()
    expect(screen.queryByText('Room Temp Topic')).toBeNull()
    expect(screen.queryByText('Valve Position Topic')).toBeNull()
  })

  it('MQTT driver: shows legacy HA fields as muted when present', () => {
    const mixedRoom = {
      ...mqttRoom,
      trv_entity: 'climate.old_trv',
      independent_sensor: 'sensor.old_temp',
    }
    render(<RoomSettings rooms={{ lounge: mixedRoom }} driver="mqtt" onRefetch={noop} />)
    expect(screen.getByText(/Legacy HA config/)).toBeInTheDocument()
    expect(screen.getByText(/climate\.old_trv/)).toBeInTheDocument()
    expect(screen.getByText(/sensor\.old_temp/)).toBeInTheDocument()
    expect(screen.getByText('Clear legacy HA fields')).toBeInTheDocument()
  })

  it('MQTT driver: no legacy section when HA fields are empty', () => {
    render(<RoomSettings rooms={{ lounge: mqttRoom }} driver="mqtt" onRefetch={noop} />)
    expect(screen.queryByText(/Legacy HA config/)).toBeNull()
  })

  it('MQTT driver: hides valve hardware/TRV name controls on direct mode', () => {
    const directRoom = {
      ...mqttRoom,
      control_mode: 'direct' as const,
      valve_hardware: 'generic' as const,
    }
    render(<RoomSettings rooms={{ lounge: directRoom }} driver="mqtt" onRefetch={noop} />)
    expect(screen.queryByText('Valve Hardware')).toBeNull()
    expect(screen.queryByText('TRV Name')).toBeNull()
  })

  it('HA driver: shows valve hardware/TRV name on direct mode', () => {
    const directRoom = {
      ...haRoom,
      control_mode: 'direct' as const,
      valve_hardware: 'generic' as const,
      trv_name: 'lounge_trv',
    }
    render(<RoomSettings rooms={{ lounge: directRoom }} driver="ha" onRefetch={noop} />)
    expect(screen.getByText('Valve Hardware')).toBeInTheDocument()
    expect(screen.getByText('TRV Name')).toBeInTheDocument()
  })
})
