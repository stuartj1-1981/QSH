// INSTRUCTION-604B T6 — the Settings MQTT window contact, its JSON key, the
// invert option and the contact delay. Cases S1 to S7.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoomSettings } from '../RoomSettings'

// Mock the hooks, in the shape of RoomSettings.window.test.tsx.
const patchMock = vi.fn()
vi.mock('../../../hooks/useConfig', () => ({
  usePatchConfig: () => ({ patch: patchMock, saving: false }),
}))
vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => ({ resolved: {} }),
}))

const TOPIC_PLACEHOLDER = 'rooms/lounge/window'
const DELAY_LABEL = 'Window open delay in seconds, lounge'
const INVERT_LABEL = 'Window sensor reads true when closed, lounge'

const room = (extra: Record<string, unknown> = {}) => ({
  lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4, ...extra },
})

function renderForm(roomExtra: Record<string, unknown> = {}, driver: 'ha' | 'mqtt' = 'mqtt') {
  render(<RoomSettings rooms={room(roomExtra)} driver={driver} onRefetch={() => {}} />)
}

const saveBtn = () => screen.getByRole('button', { name: /save changes/i })
const sections = () => patchMock.mock.calls.map((call) => call[0])
const delayField = () => screen.getByLabelText(DELAY_LABEL) as HTMLInputElement

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

describe('RoomSettings MQTT window contact (INSTRUCTION-604B)', () => {
  it('(S1) a room with no window topic shows the topic field only', () => {
    renderForm()
    expect(screen.getByPlaceholderText(TOPIC_PLACEHOLDER)).toBeInTheDocument()
    expect(screen.queryByLabelText('Window Sensor JSON Key')).toBeNull()
    expect(screen.queryByLabelText(INVERT_LABEL)).toBeNull()
    expect(screen.queryByLabelText(DELAY_LABEL)).toBeNull()
  })

  it('(S2) a stored mapping and delay are shown', () => {
    renderForm({
      mqtt_topics: { window_sensor: { topic: 'z/win', format: 'json', json_path: 'contact', invert: true } },
      window_open_delay_s: 120,
    })
    expect((screen.getByPlaceholderText(TOPIC_PLACEHOLDER) as HTMLInputElement).value).toBe('z/win')
    expect((screen.getByLabelText('Window Sensor JSON Key') as HTMLInputElement).value).toBe('contact')
    expect((screen.getByLabelText(INVERT_LABEL) as HTMLInputElement).checked).toBe(true)
    expect(delayField().value).toBe('120')
  })

  it('(S3) a typed topic is saved as the topic string, in the rooms section only', async () => {
    const user = userEvent.setup()
    renderForm()
    fireEvent.change(screen.getByPlaceholderText(TOPIC_PLACEHOLDER), { target: { value: 'z/win' } })
    await user.click(saveBtn())
    const payload = await savedRooms()
    expect(payload.lounge.mqtt_topics.window_sensor).toBe('z/win')
    expect(sections()).toEqual(['rooms'])
  })

  it('(S4) the HA driver shows no Window Sensor Topic', () => {
    renderForm({}, 'ha')
    expect(screen.queryByText('Window Sensor Topic')).toBeNull()
  })

  it('(S5) the delay is clamped to 600, and a cleared delay is not stored', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <RoomSettings rooms={room({ mqtt_topics: { window_sensor: 'z/win' } })} driver="mqtt" onRefetch={() => {}} />,
    )
    fireEvent.change(delayField(), { target: { value: '900' } })
    await user.click(saveBtn())
    expect((await savedRooms()).lounge.window_open_delay_s).toBe(600)
    unmount()

    patchMock.mockClear()
    renderForm({ mqtt_topics: { window_sensor: 'z/win' }, window_open_delay_s: 120 })
    fireEvent.change(delayField(), { target: { value: '' } })
    await user.click(saveBtn())
    const payload = await savedRooms()
    expect(payload.lounge.window_open_delay_s).toBeUndefined()
  })

  it('(S6) with three rooms, an edit of one delay changes that room only', async () => {
    const user = userEvent.setup()
    const rooms = {
      lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4, mqtt_topics: { window_sensor: 'z/lounge' }, window_open_delay_s: 900 },
      study: { area_m2: 9, facing: 'N', ceiling_m: 2.4, mqtt_topics: { window_sensor: 'z/study' }, window_open_delay_s: 30 },
      hall: { area_m2: 7, facing: 'E', ceiling_m: 2.4, mqtt_topics: { window_sensor: 'z/hall' }, window_open_delay_s: 900 },
    }
    render(<RoomSettings rooms={rooms} driver="mqtt" onRefetch={() => {}} />)
    fireEvent.change(delayField(), { target: { value: '90' } })
    await user.click(saveBtn())
    const payload = await savedRooms()
    expect(payload.lounge.window_open_delay_s).toBe(90)
    expect(payload.study.window_open_delay_s).toBe(30)
    expect(payload.hall.window_open_delay_s).toBe(900)
  })

  it('(S7) clearing the topic hides the delay, saves no topic, and keeps the delay', async () => {
    const user = userEvent.setup()
    renderForm({ mqtt_topics: { window_sensor: 'z/win' }, window_open_delay_s: 120 })
    expect(delayField()).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(TOPIC_PLACEHOLDER), { target: { value: '' } })
    expect(screen.queryByLabelText(DELAY_LABEL)).toBeNull()
    await user.click(saveBtn())
    const payload = await savedRooms()
    expect(payload.lounge.mqtt_topics?.window_sensor).toBeUndefined()
    expect(payload.lounge.window_open_delay_s).toBe(120)
  })
})
