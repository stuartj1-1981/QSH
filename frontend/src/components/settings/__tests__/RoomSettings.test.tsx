import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    // INSTRUCTION-335 M-1: rooms is now dirty-gated, so a no-edit Save no longer
    // PATCHes. A trivial area edit dirties the section; the round-trip assertion
    // (auxiliary_output unchanged) is unaffected.
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '21' } })
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
    // INSTRUCTION-335 M-1: dirty the section with a trivial area edit so the
    // dirty-gated Save still PATCHes; the strip assertion is unaffected.
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '21' } })
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
    // INSTRUCTION-335 M-1: dirty the section with a trivial area edit so the
    // dirty-gated Save still PATCHes; fixed_setpoint preservation is unaffected.
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '11' } })
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


// =============================================================================
// INSTRUCTION-224A — RoomSettings TRV Name defect cleanup
// =============================================================================


describe('TRV Name field clearability (defect 1 regression)', () => {
  it('allows clearing the TRV Name field to empty without auto-default snapback', async () => {
    const rooms = {
      kitchen: {
        area_m2: 12,
        facing: 'S',
        ceiling_m: 2.4,
        control_mode: 'direct' as const,
        valve_hardware: 'direct_type2' as const,
        trv_entity: 'climate.kitchen_trv',
        trv_name: 'kitchen_trv',
      },
    }
    const user = userEvent.setup()
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)

    const trvNameInput = screen.getByDisplayValue('kitchen_trv') as HTMLInputElement
    expect(trvNameInput.value).toBe('kitchen_trv')

    await user.clear(trvNameInput)
    expect(trvNameInput.value).toBe('')
  })
})


describe('control_mode toggle (defect 2 regression)', () => {
  it('does not populate trv_name when switching to direct mode', async () => {
    patchMock.mockClear()
    const rooms = {
      kitchen: {
        area_m2: 12,
        facing: 'S',
        ceiling_m: 2.4,
        control_mode: 'indirect' as const,
        trv_entity: 'climate.kitchen_trv',
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)

    const modeSelect = screen.getByDisplayValue('Indirect (TRV setpoint)') as HTMLSelectElement
    fireEvent.change(modeSelect, { target: { value: 'direct' } })

    fireEvent.click(screen.getByText('Save Changes'))
    expect(patchMock).toHaveBeenCalledTimes(1)
    const [, payload] = patchMock.mock.calls[0]
    expect(payload.kitchen.control_mode).toBe('direct')
    expect(payload.kitchen.valve_hardware).toBe('generic')
    expect(payload.kitchen).not.toHaveProperty('trv_name')
  })
})


describe('TRV Name field visibility for multi-emitter (defect 3 regression)', () => {
  it('does not render TRV Name input when trv_entity is a list of length 2 or more', () => {
    const rooms = {
      open_plan: {
        area_m2: 30,
        facing: 'S',
        ceiling_m: 2.4,
        control_mode: 'direct' as const,
        valve_hardware: 'direct_type2' as const,
        trv_entity: ['climate.dining_trv', 'climate.sitting_room_trv'],
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)

    expect(screen.queryByText('Valve Hardware')).not.toBeNull()
    expect(screen.queryByText('TRV Name')).toBeNull()
  })

  it('does render TRV Name input when trv_entity is scalar (single-emitter)', () => {
    const rooms = {
      kitchen: {
        area_m2: 12,
        facing: 'S',
        ceiling_m: 2.4,
        control_mode: 'direct' as const,
        valve_hardware: 'direct_type2' as const,
        trv_entity: 'climate.kitchen_trv',
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    expect(screen.queryByText('TRV Name')).not.toBeNull()
  })

  it('does render TRV Name input when trv_entity is a single-element list', () => {
    const rooms = {
      kitchen: {
        area_m2: 12,
        facing: 'S',
        ceiling_m: 2.4,
        control_mode: 'direct' as const,
        valve_hardware: 'direct_type2' as const,
        trv_entity: ['climate.kitchen_trv'],
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    expect(screen.queryByText('TRV Name')).not.toBeNull()
  })
})


// =============================================================================
// INSTRUCTION-224E — MQTT valve_position list-form editor
// =============================================================================


describe('RoomSettings MQTT valve_position list-form editor', () => {
  it('MQTT single-emitter zone shows scalar Valve Position Topic input', () => {
    const rooms = {
      kitchen: {
        area_m2: 12,
        facing: 'S',
        ceiling_m: 2.4,
        mqtt_topics: {
          room_temp: 'rooms/kitchen/temp',
          valve_position: 'rooms/kitchen/valve',
        },
      },
    }
    render(<RoomSettings rooms={rooms} driver="mqtt" onRefetch={() => {}} />)
    expect(screen.queryByText('Valve Position Topic')).not.toBeNull()
    expect(screen.queryByText('Valve Position Topics')).toBeNull()
    expect(screen.getByDisplayValue('rooms/kitchen/valve')).toBeInTheDocument()
  })

  it('MQTT multi-emitter zone shows list of valve position inputs (plural label)', () => {
    const rooms = {
      open_plan: {
        area_m2: 30,
        facing: 'S',
        ceiling_m: 2.4,
        mqtt_topics: {
          room_temp: 'rooms/open_plan/temp',
          valve_position: ['rooms/open_plan/dining', 'rooms/open_plan/sitting_room'],
        },
      },
    }
    render(<RoomSettings rooms={rooms} driver="mqtt" onRefetch={() => {}} />)
    expect(screen.queryByText('Valve Position Topics')).not.toBeNull()
    expect(screen.getByDisplayValue('rooms/open_plan/dining')).toBeInTheDocument()
    expect(screen.getByDisplayValue('rooms/open_plan/sitting_room')).toBeInTheDocument()
  })

  it('+ button adds an empty slot to a scalar valve_position', async () => {
    patchMock.mockClear()
    const rooms = {
      kitchen: {
        area_m2: 12,
        facing: 'S',
        ceiling_m: 2.4,
        mqtt_topics: { valve_position: 'rooms/kitchen/valve' },
      },
    }
    render(<RoomSettings rooms={rooms} driver="mqtt" onRefetch={() => {}} />)
    const addButton = screen.getByTitle(
      'Add additional valve position topic (multi-emitter)'
    )
    fireEvent.click(addButton)
    fireEvent.click(screen.getByText('Save Changes'))
    await vi.waitFor(() => {
      expect(patchMock).toHaveBeenCalled()
    })
    const [, payload] = patchMock.mock.calls.at(-1)!
    expect(payload.kitchen.mqtt_topics.valve_position).toEqual([
      'rooms/kitchen/valve',
      '',
    ])
  })

  it('Remove button removes a slot from a list of three down to two', async () => {
    patchMock.mockClear()
    const rooms = {
      open_plan: {
        area_m2: 30,
        facing: 'S',
        ceiling_m: 2.4,
        mqtt_topics: {
          valve_position: ['topic/a', 'topic/b', 'topic/c'],
        },
      },
    }
    render(<RoomSettings rooms={rooms} driver="mqtt" onRefetch={() => {}} />)
    // Two extras visible (b, c). Remove buttons share title "Remove this topic".
    const removeButtons = screen.getAllByTitle('Remove this topic')
    expect(removeButtons.length).toBe(2)
    fireEvent.click(removeButtons[0]) // remove 'topic/b' (first extra)
    fireEvent.click(screen.getByText('Save Changes'))
    await vi.waitFor(() => {
      expect(patchMock).toHaveBeenCalled()
    })
    const [, payload] = patchMock.mock.calls.at(-1)!
    expect(payload.open_plan.mqtt_topics.valve_position).toEqual([
      'topic/a',
      'topic/c',
    ])
  })

  it('Removing the last extra normalises back to scalar', async () => {
    patchMock.mockClear()
    const rooms = {
      open_plan: {
        area_m2: 30,
        facing: 'S',
        ceiling_m: 2.4,
        mqtt_topics: {
          valve_position: ['topic/a', 'topic/b'],
        },
      },
    }
    render(<RoomSettings rooms={rooms} driver="mqtt" onRefetch={() => {}} />)
    const removeButtons = screen.getAllByTitle('Remove this topic')
    expect(removeButtons.length).toBe(1)
    fireEvent.click(removeButtons[0])
    fireEvent.click(screen.getByText('Save Changes'))
    await vi.waitFor(() => {
      expect(patchMock).toHaveBeenCalled()
    })
    const [, payload] = patchMock.mock.calls.at(-1)!
    // Normalised: single-element list → scalar string
    expect(payload.open_plan.mqtt_topics.valve_position).toBe('topic/a')
  })

  it('Editing the primary topic in scalar mode preserves scalar shape', async () => {
    patchMock.mockClear()
    const rooms = {
      kitchen: {
        area_m2: 12,
        facing: 'S',
        ceiling_m: 2.4,
        mqtt_topics: { valve_position: 'rooms/kitchen/valve' },
      },
    }
    render(<RoomSettings rooms={rooms} driver="mqtt" onRefetch={() => {}} />)
    const input = screen.getByDisplayValue('rooms/kitchen/valve') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'rooms/kitchen/new_valve' } })
    fireEvent.click(screen.getByText('Save Changes'))
    await vi.waitFor(() => {
      expect(patchMock).toHaveBeenCalled()
    })
    const [, payload] = patchMock.mock.calls.at(-1)!
    // Stays scalar (single-element list collapses)
    expect(payload.kitchen.mqtt_topics.valve_position).toBe('rooms/kitchen/new_valve')
  })
})


// =============================================================================
// INSTRUCTION-231D — paired per-emitter heating_entity rows
// =============================================================================


describe('INSTRUCTION-231D: paired per-emitter heating_entity rows', () => {
  beforeEach(() => {
    patchMock.mockClear()
  })

  it('renders one paired emitter row when both lists are empty', () => {
    const rooms = {
      kitchen: { area_m2: 20, facing: 'N' as const, ceiling_m: 2.4 },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    // One TRV Entity label and one Heating Entity label (no numeric suffix
    // when there's only one row).
    expect(screen.getAllByText('TRV Entity').length).toBe(1)
    expect(screen.getAllByText('Heating Entity').length).toBe(1)
    // No remove buttons when rowCount === 1.
    expect(screen.queryAllByRole('button', { name: /remove emitter/i }).length).toBe(0)
  })

  it('renders N paired rows when trv and heating lists have equal length', () => {
    const rooms = {
      open_plan: {
        area_m2: 40,
        facing: 'S' as const,
        ceiling_m: 2.4,
        trv_entity: ['climate.dining_trv', 'climate.sitting_room_trv'],
        heating_entity: [
          'number.dining_trv_valve_closing_degree',
          'number.sitting_room_trv_valve_closing_degree',
        ],
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    // Two paired rows: TRV Entity + TRV Entity 2, Heating Entity + Heating Entity 2.
    expect(screen.getAllByText('TRV Entity').length).toBe(1)
    expect(screen.getAllByText('TRV Entity 2').length).toBe(1)
    expect(screen.getAllByText('Heating Entity').length).toBe(1)
    expect(screen.getAllByText('Heating Entity 2').length).toBe(1)
    expect(screen.queryAllByRole('button', { name: /remove emitter/i }).length).toBe(2)
  })

  it('renders max(trv, heating) rows when lengths differ', () => {
    const rooms = {
      open_plan: {
        area_m2: 40,
        facing: 'S' as const,
        ceiling_m: 2.4,
        trv_entity: ['climate.A', 'climate.B', 'climate.C'],
        heating_entity: 'sensor.open_plan_heating',
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    // rowCount = max(3, 1, 1) = 3. Three TRV slots + three heating slots.
    expect(screen.getAllByText('TRV Entity').length).toBe(1)
    expect(screen.getAllByText('TRV Entity 2').length).toBe(1)
    expect(screen.getAllByText('TRV Entity 3').length).toBe(1)
    expect(screen.getAllByText('Heating Entity').length).toBe(1)
    expect(screen.getAllByText('Heating Entity 2').length).toBe(1)
    expect(screen.getAllByText('Heating Entity 3').length).toBe(1)
  })

  it('add emitter appends slot to both trv and heating lists', async () => {
    const user = userEvent.setup()
    const rooms = {
      kitchen: {
        area_m2: 20,
        facing: 'N' as const,
        ceiling_m: 2.4,
        trv_entity: 'climate.kitchen_trv',
        heating_entity: 'sensor.kitchen_heating',
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    const addBtn = screen.getByRole('button', { name: /add emitter/i })
    await user.click(addBtn)
    // After click: rowCount goes from 1 → 2; new labels appear for row 2.
    expect(screen.getAllByText('TRV Entity 2').length).toBe(1)
    expect(screen.getAllByText('Heating Entity 2').length).toBe(1)
  })

  it('remove emitter removes slot at same index from both lists and round-trips through save', async () => {
    const user = userEvent.setup()
    const rooms = {
      open_plan: {
        area_m2: 40,
        facing: 'S' as const,
        ceiling_m: 2.4,
        trv_entity: ['climate.A', 'climate.B'],
        heating_entity: ['sensor.A', 'sensor.B'],
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    const removeButtons = screen.getAllByRole('button', { name: /remove emitter/i })
    expect(removeButtons.length).toBe(2)
    // Click remove on the second row (index 1).
    await user.click(removeButtons[1])
    const saveBtn = screen.getByRole('button', { name: /save changes/i })
    await user.click(saveBtn)
    expect(patchMock).toHaveBeenCalled()
    const [, payload] = patchMock.mock.calls.at(-1)!
    // After collapse-to-scalar normalisation: both fields become scalars.
    expect(payload.open_plan.trv_entity).toBe('climate.A')
    expect(payload.open_plan.heating_entity).toBe('sensor.A')
  })

  it('single-emitter scalar heating_entity contract preserved on edit', async () => {
    const user = userEvent.setup()
    const rooms = {
      bathroom: {
        area_m2: 6,
        facing: 'N' as const,
        ceiling_m: 2.4,
        trv_entity: 'climate.bathroom_trv',
        heating_entity: 'sensor.bathroom_heating',
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    // Find the heating input by placeholder. EntityField placeholder for
    // 231D paired rows: "sensor.<room>_heating or number.<room>_valve_position".
    const heInput = screen.getByPlaceholderText(
      /sensor\.<room>_heating|number\.<room>_valve_position/i,
    )
    await user.clear(heInput)
    await user.type(heInput, 'sensor.bathroom_heating_v2')
    const saveBtn = screen.getByRole('button', { name: /save changes/i })
    await user.click(saveBtn)
    expect(patchMock).toHaveBeenCalled()
    const [, payload] = patchMock.mock.calls.at(-1)!
    // V2 MEDIUM-1 contract: scalar input → scalar output (not array).
    expect(payload.bathroom.heating_entity).toBe('sensor.bathroom_heating_v2')
    expect(payload.bathroom.trv_entity).toBe('climate.bathroom_trv')
  })

  it('V2 MEDIUM-1 regression: updateHeatingAt with scalar current and index 2 preserves typed value', async () => {
    const user = userEvent.setup()
    const rooms = {
      open_plan: {
        area_m2: 40,
        facing: 'S' as const,
        ceiling_m: 2.4,
        trv_entity: ['climate.A', 'climate.B', 'climate.C'],
        heating_entity: 'sensor.shared_template', // scalar — heLen = 1, trvLen = 3
      },
    }
    render(<RoomSettings rooms={rooms} driver="ha" onRefetch={() => {}} />)
    // rowCount = max(3, 1, 1) = 3. Row index 2 has an empty heating input.
    const heInputs = screen.getAllByPlaceholderText(
      /sensor\.<room>_heating|number\.<room>_valve_position/i,
    )
    expect(heInputs.length).toBe(3)
    // Type into row 2's heating input (the 3rd one).
    await user.type(heInputs[2], 'number.C_valve_position')
    const saveBtn = screen.getByRole('button', { name: /save changes/i })
    await user.click(saveBtn)
    expect(patchMock).toHaveBeenCalled()
    const [, payload] = patchMock.mock.calls.at(-1)!
    // V2 MEDIUM-1 contract: list-form heating with row-2 value preserved.
    // Pre-V2 the value was silently dropped; heating_entity stayed scalar.
    expect(payload.open_plan.heating_entity).toEqual([
      'sensor.shared_template',
      '',
      'number.C_valve_position',
    ])
  })
})


// =============================================================================
// INSTRUCTION-333 — emitter_type selector (wizard↔Settings parity) + 'none'
// =============================================================================

describe('RoomSettings emitter_type selector (INSTRUCTION-333)', () => {
  beforeEach(() => {
    patchMock.mockClear()
  })

  const radRooms = {
    lounge: {
      area_m2: 20,
      facing: 'S',
      emitter_type: 'radiator' as const,
      emitter_kw: 1.5,
    },
  }

  const emitterSelect = () =>
    screen.getByText('Select emitter type…').closest('select') as HTMLSelectElement

  it('renders the emitter type selector with all four options', () => {
    render(<RoomSettings rooms={radRooms} driver="ha" onRefetch={() => {}} />)
    expect(screen.getByText('Emitter Type')).toBeInTheDocument()
    for (const name of [
      'Radiator',
      'Underfloor Heating',
      'Fan Coil',
      'None (no emitter)',
    ]) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument()
    }
  })

  it('an emitter_type edit flows into the rooms patch payload', () => {
    render(<RoomSettings rooms={radRooms} driver="ha" onRefetch={() => {}} />)
    fireEvent.change(emitterSelect(), { target: { value: 'ufh' } })
    fireEvent.click(screen.getByText('Save Changes'))
    expect(patchMock).toHaveBeenCalledTimes(1)
    const [section, payload] = patchMock.mock.calls[0]
    expect(section).toBe('rooms')
    expect(payload.lounge.emitter_type).toBe('ufh')
  })

  it('selecting None forces emitter_kw to 0 in the payload', () => {
    render(<RoomSettings rooms={radRooms} driver="ha" onRefetch={() => {}} />)
    fireEvent.change(emitterSelect(), { target: { value: 'none' } })
    fireEvent.click(screen.getByText('Save Changes'))
    const [, payload] = patchMock.mock.calls[0]
    expect(payload.lounge.emitter_type).toBe('none')
    expect(payload.lounge.emitter_kw).toBe(0)
  })

  it('None→Radiator yields a payload room with emitter_kw absent (EC5)', () => {
    const noneRooms = {
      lounge: {
        area_m2: 20,
        facing: 'S',
        emitter_type: 'none' as const,
        emitter_kw: 0,
      },
    }
    render(<RoomSettings rooms={noneRooms} driver="ha" onRefetch={() => {}} />)
    fireEvent.change(emitterSelect(), { target: { value: 'radiator' } })
    fireEvent.click(screen.getByText('Save Changes'))
    const [, payload] = patchMock.mock.calls[0]
    expect(payload.lounge.emitter_type).toBe('radiator')
    // emitter_kw cleared to undefined → dropped by JSON.stringify on the wire;
    // restore_redacted's full-section overwrite then drops it from the YAML and
    // area×0.1 re-applies at load. This is the EC5 link-1 falsifier.
    const wire = JSON.parse(JSON.stringify(payload.lounge))
    expect(wire).not.toHaveProperty('emitter_kw')
  })
})


// =============================================================================
// INSTRUCTION-335 — Property declaration (total_floor_area_m2, bedrooms)
// =============================================================================

describe('RoomSettings property declaration (INSTRUCTION-335)', () => {
  beforeEach(() => {
    patchMock.mockClear()
  })

  const baseRooms = { lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4 } }
  const areaInput = () => screen.getByLabelText('Total Floor Area (m²)')
  const bedroomsInput = () => screen.getByLabelText('Bedrooms — optional')
  const saveBtn = () => screen.getByRole('button', { name: /save changes/i })

  it('renders both property inputs bound to the prop', () => {
    render(
      <RoomSettings
        rooms={baseRooms}
        property={{ total_floor_area_m2: 189, bedrooms: 4 }}
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    expect(areaInput()).toHaveValue(189)
    expect(bedroomsInput()).toHaveValue(4)
  })

  it('rooms-only edit does NOT PATCH property', async () => {
    render(
      <RoomSettings
        rooms={baseRooms}
        property={{ total_floor_area_m2: 189, bedrooms: 4 }}
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '21' } })
    fireEvent.click(saveBtn())
    await vi.waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('rooms', expect.anything()),
    )
    expect(patchMock.mock.calls.find((c) => c[0] === 'property')).toBeUndefined()
  })

  it('property-only edit does NOT PATCH rooms (converse falsifier)', async () => {
    render(
      <RoomSettings
        rooms={baseRooms}
        property={{ total_floor_area_m2: 189, bedrooms: 4 }}
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    fireEvent.change(areaInput(), { target: { value: '200' } })
    fireEvent.click(saveBtn())
    await vi.waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        'property',
        expect.objectContaining({ total_floor_area_m2: 200, bedrooms: 4 }),
      ),
    )
    expect(patchMock.mock.calls.find((c) => c[0] === 'rooms')).toBeUndefined()
  })

  it('dirty-scoped gate: rooms-only edit saves with an empty property; editing area out-of-band then disables Save', async () => {
    render(
      <RoomSettings rooms={baseRooms} property={{}} driver="ha" onRefetch={() => {}} />,
    )
    // Untouched/empty declaration must never block a rooms-only save.
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '21' } })
    expect(saveBtn()).not.toBeDisabled()
    fireEvent.click(saveBtn())
    await vi.waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('rooms', expect.anything()),
    )
    expect(patchMock.mock.calls.find((c) => c[0] === 'property')).toBeUndefined()

    // Now an *edited* out-of-band declaration disables Save (dirty-scoped gate).
    fireEvent.change(areaInput(), { target: { value: '5' } })
    expect(saveBtn()).toBeDisabled()
  })

  it('bedrooms out of [0,12] shows a soft warning and never disables Save', () => {
    render(
      <RoomSettings
        rooms={baseRooms}
        property={{ total_floor_area_m2: 189 }}
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    fireEvent.change(bedroomsInput(), { target: { value: '20' } })
    expect(screen.getByText(/Outside the typical range/i)).toBeInTheDocument()
    expect(saveBtn()).not.toBeDisabled()
  })

  it('reconciliation warning shows above tolerance and never blocks Save', () => {
    // Σ room area 20 vs declared 189 → 0.89 > 0.25.
    render(
      <RoomSettings
        rooms={{ lounge: { area_m2: 20, facing: 'S' } }}
        property={{ total_floor_area_m2: 189 }}
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    expect(
      screen.getByText(/differs from the sum of room areas/i),
    ).toBeInTheDocument()
    expect(saveBtn()).not.toBeDisabled()
  })

  it('reconciliation warning is silent within tolerance', () => {
    // Σ 180 vs declared 189 → 0.048 < 0.25.
    render(
      <RoomSettings
        rooms={{ a: { area_m2: 90, facing: 'S' }, b: { area_m2: 90, facing: 'N' } }}
        property={{ total_floor_area_m2: 189 }}
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    expect(screen.queryByText(/differs from the sum of room areas/i)).toBeNull()
  })

  it('reconciliation warning is silent at declared area 0 (÷0 guard)', () => {
    render(
      <RoomSettings
        rooms={{ lounge: { area_m2: 20, facing: 'S' } }}
        property={{ total_floor_area_m2: 0 }}
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    expect(screen.queryByText(/differs from the sum of room areas/i)).toBeNull()
  })

  it('aborts on first failure: rooms PATCH fails ⇒ property not written, no onRefetch, error surfaced', async () => {
    const onRefetch = vi.fn()
    // First call (rooms) resolves null (failure); the default {ok:true} is left
    // intact for other tests. property must never be reached.
    patchMock.mockResolvedValueOnce(null)
    render(
      <RoomSettings
        rooms={baseRooms}
        property={{ total_floor_area_m2: 189, bedrooms: 4 }}
        driver="ha"
        onRefetch={onRefetch}
      />,
    )
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '21' } })
    fireEvent.change(areaInput(), { target: { value: '200' } })
    fireEvent.click(saveBtn())
    expect(await screen.findByText(/Failed to save rooms/i)).toBeInTheDocument()
    expect(patchMock.mock.calls.find((c) => c[0] === 'property')).toBeUndefined()
    expect(onRefetch).not.toHaveBeenCalled()
  })
})


// =============================================================================
// INSTRUCTION-369 — building-class edit path (construction_year, fabric_class)
// =============================================================================

describe('RoomSettings building-class edit path (INSTRUCTION-369)', () => {
  beforeEach(() => {
    patchMock.mockClear()
  })

  const baseRooms = { lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4 } }
  const yearInput = () => screen.getByLabelText('Build Year — optional')
  const materialSelect = () =>
    screen.getByLabelText('Material — optional') as HTMLSelectElement
  const saveBtn = () => screen.getByRole('button', { name: /save changes/i })

  it('renders both inputs pre-filled from the top-level root props', () => {
    render(
      <RoomSettings
        rooms={baseRooms}
        construction_year={2016}
        fabric_class="cavity_filled"
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    expect(yearInput()).toHaveValue(2016)
    expect(materialSelect().value).toBe('cavity_filled')
  })

  it('material select offers the §3.5 enum minus literal unknown, with an empty "Not set"', () => {
    render(<RoomSettings rooms={baseRooms} driver="ha" onRefetch={() => {}} />)
    const select = materialSelect()
    // Empty "Not set" present; no literal `unknown` option.
    expect(within(select).getByRole('option', { name: 'Not set' })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: /unknown/i })).toBeNull()
    // The six offered values (seven minus unknown).
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toEqual([
      '',
      'solid_wall',
      'cavity_unfilled',
      'cavity_filled',
      'timber_frame',
      'sip',
      'mixed',
    ])
  })

  it('editing the year dirties and Save issues patch("root", …) — only when dirty', async () => {
    render(
      <RoomSettings
        rooms={baseRooms}
        construction_year={2016}
        fabric_class="cavity_filled"
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    fireEvent.change(yearInput(), { target: { value: '1998' } })
    fireEvent.click(saveBtn())
    await vi.waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        'root',
        expect.objectContaining({ construction_year: 1998, fabric_class: 'cavity_filled' }),
      ),
    )
    // Building-only edit ⇒ rooms/property untouched.
    expect(patchMock.mock.calls.find((c) => c[0] === 'rooms')).toBeUndefined()
    expect(patchMock.mock.calls.find((c) => c[0] === 'property')).toBeUndefined()
  })

  it('no building edit ⇒ no root PATCH (clean-save gating)', async () => {
    render(
      <RoomSettings
        rooms={baseRooms}
        construction_year={2016}
        fabric_class="cavity_filled"
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    // Dirty rooms only; building untouched.
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '21' } })
    fireEvent.click(saveBtn())
    await vi.waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('rooms', expect.anything()),
    )
    expect(patchMock.mock.calls.find((c) => c[0] === 'root')).toBeUndefined()
  })

  it('changing the material to "Not set" clears the key (null in the root payload)', async () => {
    render(
      <RoomSettings
        rooms={baseRooms}
        construction_year={2016}
        fabric_class="cavity_filled"
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    fireEvent.change(materialSelect(), { target: { value: '' } })
    fireEvent.click(saveBtn())
    await vi.waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        'root',
        expect.objectContaining({ fabric_class: null }),
      ),
    )
  })

  it('an out-of-band year shows the soft warning and never disables Save', () => {
    render(<RoomSettings rooms={baseRooms} driver="ha" onRefetch={() => {}} />)
    fireEvent.change(yearInput(), { target: { value: '1600' } })
    expect(screen.getByText(/Outside the typical range/i)).toBeInTheDocument()
    expect(saveBtn()).not.toBeDisabled()
  })

  it('a stored unknown seeds the select as "Not set" and rides through a dirtying Save unchanged', async () => {
    render(
      <RoomSettings
        rooms={baseRooms}
        construction_year={2016}
        fabric_class="unknown"
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    // Controlled-select fidelity: stored `unknown` renders "Not set" (value '').
    expect(materialSelect().value).toBe('')
    // Dirty via a year edit; fabric_class rides through verbatim (not collapsed).
    fireEvent.change(yearInput(), { target: { value: '1998' } })
    fireEvent.click(saveBtn())
    await vi.waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        'root',
        expect.objectContaining({ construction_year: 1998, fabric_class: 'unknown' }),
      ),
    )
  })

  it('opening the box on a stored unknown without editing fires no root PATCH (verbatim hold)', async () => {
    render(
      <RoomSettings
        rooms={baseRooms}
        fabric_class="unknown"
        driver="ha"
        onRefetch={() => {}}
      />,
    )
    // No edit at all — render-time controlled-select must not dirty buildingState.
    fireEvent.click(saveBtn())
    // Nothing dirty ⇒ no PATCH of any section.
    expect(patchMock).not.toHaveBeenCalled()
  })

  it('aborts on first failure: root PATCH fails ⇒ no onRefetch, error surfaced', async () => {
    const onRefetch = vi.fn()
    patchMock.mockResolvedValueOnce(null)
    render(
      <RoomSettings
        rooms={baseRooms}
        construction_year={2016}
        driver="ha"
        onRefetch={onRefetch}
      />,
    )
    fireEvent.change(yearInput(), { target: { value: '1998' } })
    fireEvent.click(saveBtn())
    expect(await screen.findByText(/Failed to save building details/i)).toBeInTheDocument()
    expect(onRefetch).not.toHaveBeenCalled()
  })
})


// =============================================================================
// INSTRUCTION-373B — per-device battery SoC entry (Settings)
// =============================================================================

describe('RoomSettings battery devices', () => {
  beforeEach(() => patchMock.mockClear())

  const trvRoom = {
    lounge: {
      area_m2: 20,
      facing: 'S' as const,
      ceiling_m: 2.4,
      trv_entity: 'climate.lounge_trv',
      independent_sensor: 'sensor.lounge_temp',
      occupancy_sensor: 'binary_sensor.lounge_presence',
      heating_entity: 'sensor.lounge_heating',
    },
  }

  it('renders a battery field for TRV, temp sensor, and occupancy sensor', () => {
    render(<RoomSettings rooms={trvRoom} driver="ha" onRefetch={() => {}} />)
    expect(screen.getByPlaceholderText('sensor.room_trv_battery')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('sensor.room_temp_battery')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('sensor.room_occupancy_battery')).toBeInTheDocument()
  })

  it('renders no battery field for heating_entity', () => {
    render(<RoomSettings rooms={trvRoom} driver="ha" onRefetch={() => {}} />)
    // Heating Entity field exists, but no battery field is paired with it.
    expect(screen.getByText('Heating Entity')).toBeInTheDocument()
    expect(screen.queryByText(/Heating.*Battery/i)).toBeNull()
  })

  it('does not render the TRV battery field when no TRV is set', () => {
    const noTrv = { spare: { area_m2: 10, facing: 'N' as const } }
    render(<RoomSettings rooms={noTrv} driver="ha" onRefetch={() => {}} />)
    expect(screen.queryByPlaceholderText('sensor.room_trv_battery')).toBeNull()
  })

  it('seeds the battery field from the batteryDevices prop', () => {
    render(
      <RoomSettings
        rooms={trvRoom}
        driver="ha"
        batteryDevices={[
          {
            device: 'climate.lounge_trv',
            battery_entity: 'sensor.lounge_trv_battery',
            room: 'lounge',
          },
        ]}
        onRefetch={() => {}}
      />,
    )
    const input = screen.getByPlaceholderText('sensor.room_trv_battery') as HTMLInputElement
    expect(input.value).toBe('sensor.lounge_trv_battery')
  })

  it('save PATCHes battery_devices with the rebuilt list', () => {
    render(<RoomSettings rooms={trvRoom} driver="ha" onRefetch={() => {}} />)
    const input = screen.getByPlaceholderText('sensor.room_trv_battery')
    fireEvent.change(input, { target: { value: 'sensor.lounge_trv_battery' } })
    fireEvent.click(screen.getByText('Save Changes'))
    const call = patchMock.mock.calls.find((c) => c[0] === 'battery_devices')
    expect(call).toBeTruthy()
    expect(call![1]).toEqual([
      {
        device: 'climate.lounge_trv',
        battery_entity: 'sensor.lounge_trv_battery',
        room: 'lounge',
      },
    ])
  })

  it('clearing a battery removes the entry on save', () => {
    render(
      <RoomSettings
        rooms={trvRoom}
        driver="ha"
        batteryDevices={[
          {
            device: 'climate.lounge_trv',
            battery_entity: 'sensor.lounge_trv_battery',
            room: 'lounge',
          },
        ]}
        onRefetch={() => {}}
      />,
    )
    const input = screen.getByPlaceholderText('sensor.room_trv_battery')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByText('Save Changes'))
    const call = patchMock.mock.calls.find((c) => c[0] === 'battery_devices')
    expect(call).toBeTruthy()
    expect(call![1]).toEqual([])
  })

  it('renaming the TRV drops the stale battery entry on save', async () => {
    render(
      <RoomSettings
        rooms={trvRoom}
        driver="ha"
        batteryDevices={[
          {
            device: 'climate.lounge_trv',
            battery_entity: 'sensor.lounge_trv_battery',
            room: 'lounge',
          },
        ]}
        onRefetch={() => {}}
      />,
    )
    // Rename the TRV entity — the old device is no longer current.
    const trvInput = screen.getByDisplayValue('climate.lounge_trv')
    fireEvent.change(trvInput, { target: { value: 'climate.lounge_trv_new' } })
    fireEvent.click(screen.getByText('Save Changes'))
    // rooms is dirty too, so save awaits the rooms PATCH before the
    // battery_devices PATCH — wait for the latter to land.
    let call: unknown[] | undefined
    await waitFor(() => {
      call = patchMock.mock.calls.find((c) => c[0] === 'battery_devices')
      expect(call).toBeTruthy()
    })
    // Stale entry for climate.lounge_trv is excluded; the new device has no
    // battery assigned yet, so the rebuilt list is empty.
    expect(call![1]).toEqual([])
  })

  it('does not PATCH battery_devices when nothing changed', () => {
    render(<RoomSettings rooms={trvRoom} driver="ha" onRefetch={() => {}} />)
    fireEvent.click(screen.getByText('Save Changes'))
    const call = patchMock.mock.calls.find((c) => c[0] === 'battery_devices')
    expect(call).toBeFalsy()
  })
})
