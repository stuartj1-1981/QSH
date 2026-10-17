// INSTRUCTION-581 T7 — the TRV Setpoint and Valve Setpoint topic list editors in
// the room settings. Cases S1 to S16, numbered as in T7 of the instruction.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RoomSettings } from '../RoomSettings'

const patchMock = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: patchMock, saving: false }),
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {} }),
}))

beforeEach(() => {
  patchMock.mockClear()
})

describe('INSTRUCTION-581: MQTT setpoint topic list editors', () => {
  const ADD_TRV = 'Add additional TRV setpoint topic (multi-emitter)'
  const ADD_VALVE = 'Add additional valve setpoint topic (multi-emitter)'

  const mkRooms = (mqtt_topics: Record<string, unknown>) => ({
    kitchen: { area_m2: 12, facing: 'S', ceiling_m: 2.4, mqtt_topics },
  })
  const lastPayload = () => patchMock.mock.calls.at(-1)![1]
  const save = async () => {
    fireEvent.click(screen.getByText('Save Changes'))
    await vi.waitFor(() => {
      expect(patchMock).toHaveBeenCalled()
    })
  }

  it('S1: scalar trv_setpoint shows the singular label and a + button', () => {
    render(
      <RoomSettings rooms={mkRooms({ trv_setpoint: 'k/set' })} driver="mqtt" onRefetch={() => {}} />,
    )
    expect(screen.queryByText('TRV Setpoint Topic')).not.toBeNull()
    expect(screen.queryByText('TRV Setpoint Topics')).toBeNull()
    expect(screen.getByDisplayValue('k/set')).toBeInTheDocument()
    expect(screen.getByTitle(ADD_TRV)).toBeInTheDocument()
  })

  it('S2: list trv_setpoint and valve_setpoint show every topic and the plural label', () => {
    render(
      <RoomSettings
        rooms={mkRooms({ trv_setpoint: ['t/a', 't/b'], valve_setpoint: ['v/a', 'v/b', 'v/c'] })}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )
    expect(screen.queryByText('TRV Setpoint Topics')).not.toBeNull()
    expect(screen.queryByText('Valve Setpoint Topics')).not.toBeNull()
    for (const v of ['t/a', 't/b', 'v/a', 'v/b', 'v/c']) {
      expect(screen.getByDisplayValue(v)).toBeInTheDocument()
    }
    expect(screen.queryByText('TRV Setpoint Topic 2')).not.toBeNull()
    expect(screen.queryByText('Valve Setpoint Topic 3')).not.toBeNull()
  })

  it('S3: + then a typed second topic saves a two-entry list', async () => {
    render(
      <RoomSettings rooms={mkRooms({ trv_setpoint: 'k/a' })} driver="mqtt" onRefetch={() => {}} />,
    )
    fireEvent.click(screen.getByTitle(ADD_TRV))
    expect(screen.queryByText('TRV Setpoint Topics')).not.toBeNull()
    const second = screen.getByPlaceholderText('rooms/kitchen/setpoint/emitter2')
    fireEvent.change(second, { target: { value: 'k/b' } })
    await save()
    expect(lastPayload().kitchen.mqtt_topics.trv_setpoint).toEqual(['k/a', 'k/b'])
    // One PATCH, for the rooms section. The edit adds no other call.
    expect(patchMock).toHaveBeenCalledTimes(1)
    expect(patchMock.mock.calls.at(-1)![0]).toBe('rooms')
  })

  it('S4: an open blank slot is dropped at save (no empty entry in the payload)', async () => {
    render(
      <RoomSettings
        rooms={mkRooms({ trv_setpoint: 'k/a', valve_setpoint: 'k/v' })}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )
    fireEvent.click(screen.getByTitle(ADD_TRV))
    fireEvent.click(screen.getByTitle(ADD_VALVE))
    // An edit of the valve topic makes the form dirty, so that the save runs.
    fireEvent.change(screen.getByDisplayValue('k/v'), { target: { value: 'k/v2' } })
    await save()
    const topics = lastPayload().kitchen.mqtt_topics
    expect(topics.trv_setpoint).toBe('k/a')
    expect(topics.valve_setpoint).toBe('k/v2')
  })

  it('S5: removing the last extra collapses the list to a string', async () => {
    render(
      <RoomSettings
        rooms={mkRooms({ trv_setpoint: ['t/a', 't/b'] })}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )
    fireEvent.click(screen.getByTitle('Remove TRV Setpoint Topic 2'))
    expect(screen.queryByText('TRV Setpoint Topics')).toBeNull()
    await save()
    expect(lastPayload().kitchen.mqtt_topics.trv_setpoint).toBe('t/a')
  })

  it('S6: removing a middle entry keeps the others in order', async () => {
    render(
      <RoomSettings
        rooms={mkRooms({ valve_setpoint: ['v/a', 'v/b', 'v/c'] })}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )
    fireEvent.click(screen.getByTitle('Remove Valve Setpoint Topic 2'))
    await save()
    expect(lastPayload().kitchen.mqtt_topics.valve_setpoint).toEqual(['v/a', 'v/c'])
  })

  it('S7: editing the primary topic of a list keeps the other topics', async () => {
    render(
      <RoomSettings
        rooms={mkRooms({ trv_setpoint: ['t/a', 't/b'] })}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )
    fireEvent.change(screen.getByDisplayValue('t/a'), { target: { value: 't/a2' } })
    await save()
    expect(lastPayload().kitchen.mqtt_topics.trv_setpoint).toEqual(['t/a2', 't/b'])
  })

  it('S8: the two fields are independent', async () => {
    render(
      <RoomSettings
        rooms={mkRooms({ trv_setpoint: 't/a', valve_setpoint: 'v/a' })}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )
    fireEvent.click(screen.getByTitle(ADD_TRV))
    fireEvent.change(screen.getByPlaceholderText('rooms/kitchen/setpoint/emitter2'), {
      target: { value: 't/b' },
    })
    await save()
    const topics = lastPayload().kitchen.mqtt_topics
    expect(topics.trv_setpoint).toEqual(['t/a', 't/b'])
    expect(topics.valve_setpoint).toBe('v/a')
  })

  it('S9: a blank extra row stays visible while the operator edits it', () => {
    render(
      <RoomSettings
        rooms={mkRooms({ trv_setpoint: ['t/a', 't/b'] })}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )
    fireEvent.change(screen.getByDisplayValue('t/b'), { target: { value: '' } })
    expect(screen.queryByText('TRV Setpoint Topic 2')).not.toBeNull()
  })

  it('S10: clearing a sole scalar removes the key from the payload', async () => {
    render(
      <RoomSettings
        rooms={mkRooms({ room_temp: 'k/temp', trv_setpoint: 't/a' })}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )
    fireEvent.change(screen.getByDisplayValue('t/a'), { target: { value: '' } })
    await save()
    const topics = lastPayload().kitchen.mqtt_topics
    expect('trv_setpoint' in topics).toBe(false)
    expect(topics.room_temp).toBe('k/temp')
  })

  it('S11: adding a blank slot alone is not a change (no rooms PATCH)', async () => {
    const onRefetch = vi.fn()
    render(
      <RoomSettings
        rooms={mkRooms({ trv_setpoint: ['t/a', 't/b'] })}
        driver="mqtt"
        onRefetch={onRefetch}
      />,
    )
    // + adds a blank slot only. The cleaned value equals the stored value, so
    // the rooms dirty-gate stays closed and the save sends no PATCH.
    fireEvent.click(screen.getByTitle(ADD_TRV))
    fireEvent.click(screen.getByText('Save Changes'))
    await vi.waitFor(() => {
      expect(onRefetch).toHaveBeenCalled()
    })
    expect(patchMock).not.toHaveBeenCalled()
  })

  it('S12: a stored entry that is not a string does not stop the form', () => {
    render(
      <RoomSettings
        rooms={mkRooms({ trv_setpoint: 5, valve_setpoint: ['v/a', 7, null] })}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )
    expect(screen.queryByText('TRV Setpoint Topic')).not.toBeNull()
    expect(screen.getByDisplayValue('v/a')).toBeInTheDocument()
    // An entry that is not a string shows as a blank input, never as its text.
    expect(screen.queryByDisplayValue('5')).toBeNull()
    expect(screen.queryByDisplayValue('7')).toBeNull()
  })

  it('S13: an edit of one key, then an edit of the other, keeps both edits', async () => {
    render(
      <RoomSettings
        rooms={mkRooms({ trv_setpoint: 't/a', valve_setpoint: 'v/a' })}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )
    fireEvent.change(screen.getByDisplayValue('v/a'), { target: { value: 'v/b' } })
    fireEvent.click(screen.getByTitle(ADD_TRV))
    fireEvent.change(screen.getByPlaceholderText('rooms/kitchen/setpoint/emitter2'), {
      target: { value: 't/b' },
    })
    await save()
    const topics = lastPayload().kitchen.mqtt_topics
    expect(topics.valve_setpoint).toBe('v/b')
    expect(topics.trv_setpoint).toEqual(['t/a', 't/b'])
  })

  it('S14: an edit in one room leaves the other room as it was', async () => {
    const rooms = {
      kitchen: { area_m2: 12, facing: 'S', ceiling_m: 2.4, mqtt_topics: { trv_setpoint: 'k/a' } },
      lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4, mqtt_topics: { trv_setpoint: 'l/a' } },
    }
    render(<RoomSettings rooms={rooms} driver="mqtt" onRefetch={() => {}} />)
    fireEvent.click(screen.getAllByTitle(ADD_TRV)[1])
    fireEvent.change(screen.getByPlaceholderText('rooms/lounge/setpoint/emitter2'), {
      target: { value: 'l/b' },
    })
    await save()
    expect(lastPayload().lounge.mqtt_topics.trv_setpoint).toEqual(['l/a', 'l/b'])
    expect(lastPayload().kitchen.mqtt_topics.trv_setpoint).toBe('k/a')
  })

  it('S15: the clean applies to the two setpoint keys only', async () => {
    const roomTemp = { topic: 'k/temp', format: 'json', json_path: 'a.b' }
    render(
      <RoomSettings
        rooms={mkRooms({
          room_temp: roomTemp,
          valve_position: ['p/1', 'p/2'],
          occupancy_sensor: 'k/occ',
          trv_setpoint: 't/a',
        })}
        driver="mqtt"
        onRefetch={() => {}}
      />,
    )
    fireEvent.click(screen.getByTitle(ADD_TRV))
    fireEvent.change(screen.getByPlaceholderText('rooms/kitchen/setpoint/emitter2'), {
      target: { value: 't/b' },
    })
    await save()
    const topics = lastPayload().kitchen.mqtt_topics
    expect(topics.room_temp).toEqual(roomTemp)
    expect(topics.valve_position).toEqual(['p/1', 'p/2'])
    expect(topics.occupancy_sensor).toBe('k/occ')
    expect(topics.trv_setpoint).toEqual(['t/a', 't/b'])
  })

  it('S16: a stored shape that is not canonical is normalised in every room at save', async () => {
    const loungeTopics: Record<string, unknown> = {
      trv_setpoint: ['l/a'],
      valve_setpoint: { topic: 'l/v' },
    }
    const rooms = {
      kitchen: { area_m2: 12, facing: 'S', ceiling_m: 2.4, mqtt_topics: { room_temp: 'k/temp' } },
      lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4, mqtt_topics: loungeTopics },
    }
    render(<RoomSettings rooms={rooms} driver="mqtt" onRefetch={() => {}} />)
    fireEvent.change(screen.getByDisplayValue('k/temp'), { target: { value: 'k/temp2' } })
    await save()
    const lounge = lastPayload().lounge.mqtt_topics
    expect(lounge.trv_setpoint).toBe('l/a')
    expect('valve_setpoint' in lounge).toBe(false)
  })
})
