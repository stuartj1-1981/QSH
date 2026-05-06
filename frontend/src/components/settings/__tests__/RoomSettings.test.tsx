import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RoomSettings } from '../RoomSettings'
import { stripFixedSetpointForControlMode } from '../../../lib/roomConfig'

// Mock the hooks
const patchMock = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: patchMock, saving: false }),
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


// =============================================================================
// INSTRUCTION-162A — auxiliary_output integration with RoomSettings
// =============================================================================


describe('RoomSettings auxiliary_output integration', () => {
  const baseRooms = {
    lounge: {
      area_m2: 20,
      facing: 'S',
      ceiling_m: 2.4,
      trv_entity: 'climate.lounge',
    },
  }

  it('renders an Auxiliary output section per room', () => {
    render(<RoomSettings rooms={baseRooms} driver="ha" onRefetch={() => {}} />)
    expect(screen.getAllByText('Auxiliary output').length).toBe(1)
  })

  it('save patches a payload that includes auxiliary_output round-trip', async () => {
    patchMock.mockClear()
    const rooms = {
      lounge: {
        area_m2: 20,
        facing: 'S',
        ceiling_m: 2.4,
        trv_entity: 'climate.lounge',
        auxiliary_output: {
          enabled: true,
          ha_entity: 'switch.lounge_panel',
          rated_kw: 1.5,
        },
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    fireEvent.click(screen.getByText('Save Changes'))
    expect(patchMock).toHaveBeenCalledTimes(1)
    const [section, payload] = patchMock.mock.calls[0]
    expect(section).toBe('rooms')
    expect(payload.lounge.auxiliary_output).toEqual({
      enabled: true,
      ha_entity: 'switch.lounge_panel',
      rated_kw: 1.5,
    })
  })

  it('Save button is disabled when aux is enabled with empty target field', () => {
    const rooms = {
      lounge: {
        area_m2: 20,
        facing: 'S',
        ceiling_m: 2.4,
        trv_entity: 'climate.lounge',
        auxiliary_output: {
          enabled: true, // no ha_entity → invalid
        },
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    const saveBtn = screen.getByText('Save Changes').closest('button')!
    expect(saveBtn).toBeDisabled()
  })

  it('Save button is enabled when no aux block is present', () => {
    render(<RoomSettings rooms={baseRooms} driver="ha" onRefetch={() => {}} />)
    const saveBtn = screen.getByText('Save Changes').closest('button')!
    expect(saveBtn).not.toBeDisabled()
  })
})


// =============================================================================
// INSTRUCTION-172 — fixed_setpoint conditional input + state preservation
// =============================================================================


describe('RoomSettings fixed_setpoint conditional input', () => {
  it('renders the fixed_setpoint input when control_mode is "none"', () => {
    const rooms = {
      spare: {
        area_m2: 10,
        facing: 'N',
        control_mode: 'none' as const,
        independent_sensor: 'sensor.spare_temp',
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    expect(screen.queryByText('Fixed Setpoint (°C)')).not.toBeNull()
  })

  it('does not render the fixed_setpoint input when control_mode is "indirect"', () => {
    const rooms = {
      lounge: {
        area_m2: 20,
        facing: 'S',
        control_mode: 'indirect' as const,
        trv_entity: 'climate.lounge',
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    expect(screen.queryByText('Fixed Setpoint (°C)')).toBeNull()
  })

  it('does not render the fixed_setpoint input when control_mode is "direct"', () => {
    const rooms = {
      lounge: {
        area_m2: 20,
        facing: 'S',
        control_mode: 'direct' as const,
        trv_entity: 'climate.lounge',
        valve_hardware: 'generic' as const,
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    expect(screen.queryByText('Fixed Setpoint (°C)')).toBeNull()
  })

  it('shows pre-existing fixed_setpoint value in the input', () => {
    const rooms = {
      spare: {
        area_m2: 10,
        facing: 'N',
        control_mode: 'none' as const,
        fixed_setpoint: 19,
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    const input = screen.getByTestId('fixed-setpoint-spare').querySelector('input')!
    expect(input.value).toBe('19')
  })

  it('rejects values outside [10, 25] in the input handler', () => {
    const rooms = {
      spare: {
        area_m2: 10,
        facing: 'N',
        control_mode: 'none' as const,
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    const input = screen.getByTestId('fixed-setpoint-spare').querySelector('input')! as HTMLInputElement
    fireEvent.change(input, { target: { value: '5' } })
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: '30' } })
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: '19' } })
    expect(input.value).toBe('19')
  })

  it('save omits fixed_setpoint from API payload when control_mode !== "none"', async () => {
    patchMock.mockClear()
    const rooms = {
      lounge: {
        area_m2: 20,
        facing: 'S',
        control_mode: 'indirect' as const,
        trv_entity: 'climate.lounge',
        // Pre-existing fixed_setpoint that the user might have typed before
        // toggling mode — it lives in state but must not be sent.
        fixed_setpoint: 19,
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    fireEvent.click(screen.getByText('Save Changes'))
    expect(patchMock).toHaveBeenCalledTimes(1)
    const [section, payload] = patchMock.mock.calls[0]
    expect(section).toBe('rooms')
    expect(payload.lounge).not.toHaveProperty('fixed_setpoint')
  })

  it('save preserves fixed_setpoint when control_mode === "none"', async () => {
    patchMock.mockClear()
    const rooms = {
      spare: {
        area_m2: 10,
        facing: 'N',
        control_mode: 'none' as const,
        fixed_setpoint: 19,
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    fireEvent.click(screen.getByText('Save Changes'))
    expect(patchMock).toHaveBeenCalledTimes(1)
    const [, payload] = patchMock.mock.calls[0]
    expect(payload.spare.fixed_setpoint).toBe(19)
  })
})


describe('stripFixedSetpointForControlMode helper', () => {
  it('preserves fixed_setpoint when control_mode === "none"', () => {
    const room = { area_m2: 10, control_mode: 'none' as const, fixed_setpoint: 19 }
    expect(stripFixedSetpointForControlMode(room)).toEqual(room)
  })

  it('strips fixed_setpoint when control_mode !== "none"', () => {
    const room = {
      area_m2: 10,
      control_mode: 'indirect' as const,
      trv_entity: 'climate.x',
      fixed_setpoint: 19,
    }
    const stripped = stripFixedSetpointForControlMode(room)
    expect(stripped).not.toHaveProperty('fixed_setpoint')
    expect(stripped.control_mode).toBe('indirect')
    expect(stripped.trv_entity).toBe('climate.x')
  })

  it('passes through rooms without fixed_setpoint unchanged', () => {
    const room = { area_m2: 10, control_mode: 'indirect' as const }
    expect(stripFixedSetpointForControlMode(room)).toBe(room)
  })

  it('treats undefined control_mode as not-none and strips fixed_setpoint', () => {
    const room = { area_m2: 10, fixed_setpoint: 19 }
    const stripped = stripFixedSetpointForControlMode(room)
    expect(stripped).not.toHaveProperty('fixed_setpoint')
  })
})
