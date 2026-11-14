// INSTRUCTION-627B T7(b) — the Settings TRV setpoint readback field, its JSON
// key, the list note and the default control mode. Cases S1 to S8.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoomSettings } from '../RoomSettings'

// Mock the hooks, in the shape of RoomSettings.mqttWindow.test.tsx.
const patchMock = vi.fn()
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: patchMock, saving: false }),
}))
vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {} }),
}))

const TOPIC_PLACEHOLDER = 'rooms/lounge/setpoint/state'
const KEY_LABEL = 'TRV Setpoint Readback JSON Key'
const LABEL = 'TRV Setpoint Readback Topic'

const room = (extra: Record<string, unknown> = {}) => ({
  lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4, ...extra },
})

function renderForm(roomExtra: Record<string, unknown> = {}, driver: 'ha' | 'mqtt' = 'mqtt') {
  render(<RoomSettings rooms={room(roomExtra)} driver={driver} onRefetch={() => {}} />)
}

const saveBtn = () => screen.getByRole('button', { name: /save changes/i })
const topicInput = () => screen.getByPlaceholderText(TOPIC_PLACEHOLDER) as HTMLInputElement
const controlModeValue = () =>
  (screen.getByText('Control Mode').parentElement!.querySelector('select') as HTMLSelectElement).value

async function savedRooms() {
  await waitFor(() => expect(patchMock).toHaveBeenCalled())
  const [section, payload] = patchMock.mock.calls[0]
  expect(section).toBe('rooms')
  return payload
}

beforeEach(() => {
  patchMock.mockReset()
  patchMock.mockResolvedValue({ ok: true })
})

describe('RoomSettings TRV setpoint readback (INSTRUCTION-627B)', () => {
  it('(S1) a room with no readback topic shows the topic field only', () => {
    renderForm()
    expect(topicInput()).toBeInTheDocument()
    expect(screen.queryByLabelText(KEY_LABEL)).toBeNull()
  })

  it('(S2) a stored mapping is shown', () => {
    renderForm({
      mqtt_topics: {
        trv_setpoint_readback: { topic: 'z/trv', format: 'json', json_path: 'occupied_heating_setpoint' },
      },
    })
    expect(topicInput().value).toBe('z/trv')
    expect((screen.getByLabelText(KEY_LABEL) as HTMLInputElement).value).toBe('occupied_heating_setpoint')
  })

  it('(S3) a typed topic is saved as the topic string', async () => {
    const user = userEvent.setup()
    renderForm()
    fireEvent.change(topicInput(), { target: { value: 'z/trv' } })
    await user.click(saveBtn())
    const payload = await savedRooms()
    expect(payload.lounge.mqtt_topics.trv_setpoint_readback).toBe('z/trv')
  })

  it('(S4) a typed JSON key is saved as the json mapping', async () => {
    const user = userEvent.setup()
    renderForm({ mqtt_topics: { trv_setpoint_readback: 'z/trv' } })
    fireEvent.change(screen.getByLabelText(KEY_LABEL), { target: { value: 'occupied_heating_setpoint' } })
    await user.click(saveBtn())
    const payload = await savedRooms()
    expect(payload.lounge.mqtt_topics.trv_setpoint_readback).toEqual({
      topic: 'z/trv', format: 'json', json_path: 'occupied_heating_setpoint',
    })
  })

  it('(S5) a cleared topic saves no readback key', async () => {
    const user = userEvent.setup()
    renderForm({ mqtt_topics: { room_temp: 'z/temp', trv_setpoint_readback: 'z/trv' } })
    fireEvent.change(topicInput(), { target: { value: '' } })
    await user.click(saveBtn())
    const payload = await savedRooms()
    expect(payload.lounge.mqtt_topics.trv_setpoint_readback).toBeUndefined()
    expect('trv_setpoint_readback' in payload.lounge.mqtt_topics).toBe(false)
    expect(payload.lounge.mqtt_topics.room_temp).toBe('z/temp')
  })

  it('(S6) a list of two is shown and is saved unchanged', async () => {
    const user = userEvent.setup()
    const list = [
      { topic: 'z/trv1', format: 'json', json_path: 'occupied_heating_setpoint' },
      { topic: 'z/trv2', format: 'json', json_path: 'occupied_heating_setpoint' },
    ]
    renderForm({ mqtt_topics: { trv_setpoint_readback: list } })
    const note = screen.getByTestId('lounge-trv-readback-list')
    expect(note).toHaveTextContent('z/trv1')
    expect(note).toHaveTextContent('z/trv2')
    expect(screen.queryByPlaceholderText(TOPIC_PLACEHOLDER)).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('rooms/lounge/window'), { target: { value: 'z/win' } })
    await user.click(saveBtn())
    const payload = await savedRooms()
    expect(payload.lounge.mqtt_topics.trv_setpoint_readback).toEqual(list)
    expect(payload.lounge.mqtt_topics.window_sensor).toBe('z/win')
  })

  it('(S7) the HA driver shows no readback topic', () => {
    renderForm({}, 'ha')
    expect(screen.queryByText(LABEL)).toBeNull()
    expect(screen.queryByPlaceholderText(TOPIC_PLACEHOLDER)).toBeNull()
  })

  it('(S8) a room with no stored control mode shows None on MQTT and Indirect on HA', () => {
    const a = render(<RoomSettings rooms={room()} driver="mqtt" onRefetch={() => {}} />)
    expect(controlModeValue()).toBe('none')
    a.unmount()
    const b = render(<RoomSettings rooms={room({ trv_entity: 'climate.x' })} driver="mqtt" onRefetch={() => {}} />)
    expect(controlModeValue()).toBe('none')
    b.unmount()
    render(<RoomSettings rooms={room({ trv_entity: 'climate.x' })} driver="ha" onRefetch={() => {}} />)
    expect(controlModeValue()).toBe('indirect')
  })
})
